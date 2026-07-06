/**
 * parseInput — 自然语言智能解析
 *
 * 从中文自然语言输入中提取：
 *   - title:      事项标题（去掉时间/优先级/标签后的剩余文本）
 *   - startTime:  开始时间 (Date)
 *   - endTime:    结束时间 (Date)
 *   - priority:   优先级 (P0-P3)
 *   - tags:       标签数组
 *   - rawText:    原始输入
 *
 * 纯前端正则解析，无外部依赖。解析失败时优雅降级，不抛异常。
 */

// ── 优先级关键词 ──────────────────────────────────────────
const PRIORITY_PATTERNS = [
  { pattern: /#p0|#紧急|#urgent/i,                          priority: 'P0' },
  { pattern: /#p1|#重要|#important/i,                       priority: 'P1' },
  { pattern: /#p2|#普通|#normal/i,                          priority: 'P2' },
  { pattern: /#p3|#低优|#低优先级|#low/i,                    priority: 'P3' },
];

// ── 标签提取 ──────────────────────────────────────────────
const TAG_PATTERN = /#([\u4e00-\u9fa5\w]+)/g;

// ── 相对日期 ──────────────────────────────────────────────
const DAY_NAMES = {
  '今天': 0, '今日': 0,
  '明天': 1, '明日': 1,
  '后天': 2, '后日': 2,
  '大后天': 3,
  '昨天': -1, '昨日': -1,
  '前天': -2,
};

const WEEKDAY_NAMES = {
  '周一': 1, '周二': 2, '周三': 3, '周四': 4,
  '周五': 5, '周六': 6, '周日': 7, '星期天': 7,
  '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4,
  '星期五': 5, '星期六': 6, '星期日': 7,
  '下周一': 8, '下周二': 9, '下周三': 10, '下周四': 11,
  '下周五': 12, '下周六': 13, '下周日': 14,
  '下星期一': 8, '下星期二': 9, '下星期三': 10, '下星期四': 11,
  '下星期五': 12, '下星期六': 13, '下星期日': 14,
};

// ── 时间模式 ──────────────────────────────────────────────
// "下午3点"、"15:00"、"3点半"、"15:30"、"3点15分"
const TIME_PATTERN =
  /(上午|下午|晚上|早上|中午|凌晨)?\s*([\d一二三四五六七八九十两]{1,2})\s*[:：]\s*([\d一二三四五六七八九十两]{2})|(上午|下午|晚上|早上|中午|凌晨)?\s*([\d一二三四五六七八九十两]{1,2})点(半|([\d一二三四五六七八九十两]{1,2})分)?/g;

const PERIOD_OFFSET = {
  '凌晨': 0, '早上': 0, '上午': 0,
  '中午': 12, '下午': 12, '晚上': 12,
};

// ── 日期时间连用 ──────────────────────────────────────────
// "明天下午3点"、"后天15:30"、"明天下午三点"
const DATE_TIME_PATTERN =
  /(今天|今日|明天|明日|后天|后日|大后天|昨天|昨日|前天|下?周[一二三四五六日天]|下?星期[一二三四五六日天])\s*(上午|下午|晚上|早上|中午|凌晨)?\s*([\d一二三四五六七八九十两]{1,2})[:：]([\d一二三四五六七八九十两]{2})|(今天|今日|明天|明日|后天|后日|大后天|昨天|昨日|前天|下?周[一二三四五六日天]|下?星期[一二三四五六日天])\s*(上午|下午|晚上|早上|中午|凌晨)?\s*([\d一二三四五六七八九十两]{1,2})点(半|([\d一二三四五六七八九十两]{1,2})分)?/g;

// ── 时间范围 ──────────────────────────────────────────────
// "3点到5点"、"15:00-16:00"、"3点-5点"、"下午三点到五点"
const RANGE_PATTERN =
  /([\d一二三四五六七八九十两]{1,2})[:：]([\d一二三四五六七八九十两]{2})\s*[-~至到]\s*([\d一二三四五六七八九十两]{1,2})[:：]([\d一二三四五六七八九十两]{2})|(上午|下午|晚上|早上|中午|凌晨)?\s*([\d一二三四五六七八九十两]{1,2})点(?:半|([\d一二三四五六七八九十两]{1,2})分)?\s*[-~至到]\s*(上午|下午|晚上|早上|中午|凌晨)?\s*([\d一二三四五六七八九十两]{1,2})点(?:半|([\d一二三四五六七八九十两]{1,2})分)?/;

// ── 绝对日期 ──────────────────────────────────────────────
// "1月15日"、"2025-01-15"、"2025/01/15"
const ABSOLUTE_DATE = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/;

// ── 时长 ──────────────────────────────────────────────────
// "1小时"、"30分钟"、"2个半小时"
const DURATION_PATTERN = /(\d+)\s*(小时|个?钟头|分钟|个?半(?:小时|钟头))/g;

// ============================================================
// 主解析函数
// ============================================================

export function parseInput(rawText) {
  if (!rawText || !rawText.trim()) {
    return { title: '', startTime: null, endTime: null, priority: 'P2', tags: [], rawText: '' };
  }

  let text = rawText.trim();
  const now = new Date();

  // 1. 提取优先级
  let priority = 'P2';
  for (const { pattern, priority: p } of PRIORITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      priority = p;
      text = text.replace(pattern, '').trim();
      break;
    }
  }

  // 2. 提取标签
  const tags = [];
  const tagMatches = text.matchAll(TAG_PATTERN);
  for (const m of tagMatches) {
    // 跳过优先级标签（已经处理过）
    const tag = m[1];
    const isPriority = /^p[0-3]$/i.test(tag) ||
      /^(紧急|urgent|重要|important|普通|normal|低优|低优先级|low)$/i.test(tag);
    if (!isPriority) {
      tags.push(tag);
    }
  }
  // 移除所有 #xxx 标签
  text = text.replace(TAG_PATTERN, '').trim();

  // 3. 提取日期时间
  let startTime = null;
  let endTime = null;

  // 3a. 先尝试时间范围模式（包含日期+时间范围）
  const rangeMatch = text.match(RANGE_PATTERN);
  if (rangeMatch) {
    const startResult = parseTimeString(rangeMatch[0].split(/[-~至到]/)[0].trim(), now);
    const endResult = parseTimeString(rangeMatch[0].split(/[-~至到]/)[1].trim(), now);
    startTime = startResult;
    // 如果结束时间比开始时间早，说明跨天了
    if (startResult && endResult && endResult <= startResult) {
      endResult.setDate(endResult.getDate() + 1);
    }
    endTime = endResult;
    text = text.replace(rangeMatch[0], '').trim();
  } else {
    // 3b. 日期+时间连用
    const dtMatches = [...text.matchAll(DATE_TIME_PATTERN)];
    if (dtMatches.length > 0) {
      for (const m of dtMatches) {
        const dtStr = m[0];
        const parsed = parseDateTimeString(dtStr, now);
        if (parsed) {
          if (!startTime) {
            startTime = parsed;
          } else if (!endTime) {
            endTime = parsed;
          }
        }
        text = text.replace(dtStr, '').trim();
      }
    } else {
      // 3c. 绝对日期
      const absMatch = text.match(ABSOLUTE_DATE);
      if (absMatch) {
        const year = parseInt(absMatch[1]);
        const month = parseInt(absMatch[2]) - 1;
        const day = parseInt(absMatch[3]);
        const d = new Date(year, month, day);
        d.setHours(9, 0, 0, 0);
        startTime = d;
        text = text.replace(absMatch[0], '').trim();
      }

      // 3d. 相对日期（明天、后天等）
      if (!startTime) {
        for (const [name, offset] of Object.entries(DAY_NAMES)) {
          if (text.includes(name)) {
            const d = new Date(now);
            d.setDate(d.getDate() + offset);
            d.setHours(9, 0, 0, 0);
            startTime = d;
            text = text.replace(name, '').trim();
            break;
          }
        }
      }

      // 3e. 星期几
      if (!startTime) {
        for (const [name, targetDay] of Object.entries(WEEKDAY_NAMES)) {
          if (text.includes(name)) {
            const d = getNextWeekday(now, targetDay);
            d.setHours(9, 0, 0, 0);
            startTime = d;
            text = text.replace(name, '').trim();
            break;
          }
        }
      }

      // 3f. 纯时间（今天几点）
      if (!startTime) {
        const timeResult = extractFirstTime(text, now);
        if (timeResult) {
          startTime = timeResult.time;
          text = text.replace(timeResult.matched, '').trim();
        }
      }
    }
  }

  // 4. 提取时长（如果有开始时间，计算结束时间）
  if (startTime && !endTime) {
    const durMatch = text.match(DURATION_PATTERN);
    if (durMatch) {
      endTime = new Date(startTime);
      const durStr = durMatch[0];
      const numMatch = durStr.match(/(\d+)/);
      const num = parseInt(numMatch[1]);
      if (durStr.includes('半')) {
        endTime.setMinutes(endTime.getMinutes() + num * 60 + 30);
      } else if (durStr.includes('小时') || durStr.includes('钟头')) {
        endTime.setHours(endTime.getHours() + num);
      } else if (durStr.includes('分钟')) {
        endTime.setMinutes(endTime.getMinutes() + num);
      }
      text = text.replace(durMatch[0], '').trim();
    } else if (startTime) {
      // 默认 1 小时
      endTime = new Date(startTime);
      endTime.setHours(endTime.getHours() + 1);
    }
  }

  // 5. 剩余文本作为标题
  let title = text.replace(/\s+/g, ' ').trim();
  // 去掉末尾的句号、逗号
  title = title.replace(/[，,。！!；;]+$/g, '').trim();

  return {
    title,
    startTime: startTime ? startTime.toISOString() : null,
    endTime: endTime ? endTime.toISOString() : null,
    priority,
    tags,
    rawText,
  };
}

// 中文数字映射
const CN_NUMBERS = {
  '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
  '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
};

function parseChineseNumber(str) {
  if (!str) return 0;
  const trimmed = str.trim();
  // 纯阿拉伯数字
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed);
  // 单个中文数字
  if (CN_NUMBERS[trimmed] !== undefined) return CN_NUMBERS[trimmed];
  // 处理 "十五"、"二十三" 等
  let num = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    const v = CN_NUMBERS[c];
    if (v === undefined) continue;
    if (v === 10) {
      if (num === 0) num = 10;
      else num = num * 10;
    } else {
      num = num * 10 + v;
    }
  }
  return num;
}

function parseTimeString(str, now) {
  str = str.trim();
  const d = new Date(now);

  // 检查相对日期前缀
  for (const [name, offset] of Object.entries(DAY_NAMES)) {
    if (str.startsWith(name)) {
      d.setDate(d.getDate() + offset);
      str = str.slice(name.length).trim();
      break;
    }
  }

  // 检查星期前缀
  for (const [name, targetDay] of Object.entries(WEEKDAY_NAMES)) {
    if (str.startsWith(name)) {
      const next = getNextWeekday(now, targetDay);
      d.setFullYear(next.getFullYear(), next.getMonth(), next.getDate());
      str = str.slice(name.length).trim();
      break;
    }
  }

  // 解析 HH:MM
  let match = str.match(/^([\d一二三四五六七八九十两]{1,2})[:：]([\d一二三四五六七八九十两]{2})$/);
  if (match) {
    let hour = parseChineseNumber(match[1]);
    const min = parseChineseNumber(match[2]);
    d.setHours(hour, min, 0, 0);
    return d;
  }

  // 解析 "上午9点"、"下午3点半"、"下午三点" 等
  match = str.match(/^(上午|下午|晚上|早上|中午|凌晨)?\s*([\d一二三四五六七八九十两]{1,2})点(半|([\d一二三四五六七八九十两]{1,2})分)?$/);
  if (match) {
    const period = match[1] || '';
    let hour = parseChineseNumber(match[2]);
    const isHalf = match[3] === '半';
    const extraMin = match[4] ? parseChineseNumber(match[4]) : 0;

    // 处理时段偏移
    if (period === '下午' || period === '晚上') {
      if (hour < 12) hour += 12;
    } else if (period === '中午' && hour < 12) {
      hour += 12;
    }

    d.setHours(hour, isHalf ? 30 : extraMin, 0, 0);
    return d;
  }

  return null;
}

function parseDateTimeString(str, now) {
  return parseTimeString(str, now);
}

function extractFirstTime(text, now) {
  const d = new Date(now);

  // HH:MM
  let match = text.match(/([\d一二三四五六七八九十两]{1,2})[:：]([\d一二三四五六七八九十两]{2})/);
  if (match) {
    d.setHours(parseChineseNumber(match[1]), parseChineseNumber(match[2]), 0, 0);
    return { time: d, matched: match[0] };
  }

  // X点/X点半/X点X分
  match = text.match(/(上午|下午|晚上|早上|中午|凌晨)?\s*([\d一二三四五六七八九十两]{1,2})点(半|([\d一二三四五六七八九十两]{1,2})分)?/);
  if (match) {
    const period = match[1] || '';
    let hour = parseChineseNumber(match[2]);
    const isHalf = match[3] === '半';
    const extraMin = match[4] ? parseChineseNumber(match[4]) : 0;

    if ((period === '下午' || period === '晚上') && hour < 12) hour += 12;
    else if (period === '中午' && hour < 12) hour += 12;

    d.setHours(hour, isHalf ? 30 : extraMin, 0, 0);
    return { time: d, matched: match[0] };
  }

  return null;
}

function getNextWeekday(now, targetDay) {
  // targetDay: 1=周一 ... 7=周日。下周一=8, 下周二=9...下周日=14
  const isNextWeek = targetDay > 7;
  const actualTarget = isNextWeek ? targetDay - 7 : targetDay;
  const currentDay = now.getDay() || 7; // 周日 = 7

  let diff = actualTarget - currentDay;
  if (diff <= 0) diff += 7;
  if (isNextWeek) diff += 7;

  const d = new Date(now);
  d.setDate(d.getDate() + diff);
  return d;
}
