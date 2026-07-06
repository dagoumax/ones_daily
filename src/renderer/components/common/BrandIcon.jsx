import React from 'react';

// 厂商品牌官方 SVG 图标
// 使用 CSS mask-image 方案：兼容性好，无需额外依赖，支持颜色继承

const ICON_MAP = {
  openai:       require('../../assets/icons/openai.svg'),
  anthropic:    require('../../assets/icons/anthropic.svg'),
  google:       require('../../assets/icons/google.svg'),
  deepseek:     require('../../assets/icons/deepseek.svg'),
  chatglm:      require('../../assets/icons/chatglm.svg'),
  qwen:         require('../../assets/icons/qwen.svg'),
  moonshot:     require('../../assets/icons/moonshot.svg'),
  xiaomimimo:   require('../../assets/icons/xiaomimimo.svg'),
  ollama:       require('../../assets/icons/ollama.svg'),
};

/**
 * @param {{ brand: string, size?: number, color?: string, className?: string }} props
 */
export default function BrandIcon({ brand, size = 20, color = 'currentColor', className }) {
  const iconUrl = ICON_MAP[brand];
  if (!iconUrl) return null;

  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundColor: color,
        maskImage: `url(${iconUrl})`,
        WebkitMaskImage: `url(${iconUrl})`,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        flexShrink: 0,
      }}
    />
  );
}

export { ICON_MAP };
