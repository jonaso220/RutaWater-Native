export const MAX_CONTENT_WIDTH = 600;

export const getResponsiveLayout = (width: number, height: number) => {
  // A wide viewport with little vertical space still needs phone-sized UI.
  const isPhoneLandscape = width > height && height <= MAX_CONTENT_WIDTH;
  const isWide = width > MAX_CONTENT_WIDTH && !isPhoneLandscape;
  const fontScale = isWide ? Math.min(1.5, Math.max(1, width / 700)) : 1;

  return { isWide, isPhoneLandscape, fontScale, width, height, MAX_CONTENT_WIDTH };
};
