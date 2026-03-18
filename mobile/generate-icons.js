import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const ASSETS_DIR = path.resolve('./assets');
const PRIMARY_COLOR = '#CA8A04';
const LIGHT_BG = '#F4F1EA';

const ioniconsPaths = `
    <path fill="${PRIMARY_COLOR}" d="M64,480H48a32,32,0,0,1-32-32V112A32,32,0,0,1,48,80H64a32,32,0,0,1,32,32V448A32,32,0,0,1,64,480Z"/>
    <path fill="${PRIMARY_COLOR}" d="M240,176a32,32,0,0,0-32-32H144a32,32,0,0,0-32,32v28a4,4,0,0,0,4,4H236a4,4,0,0,0,4-4Z"/>
    <path fill="${PRIMARY_COLOR}" d="M112,448a32,32,0,0,0,32,32h64a32,32,0,0,0,32-32V418a2,2,0,0,0-2-2H114a2,2,0,0,0-2,2Z"/>
    <rect fill="${PRIMARY_COLOR}" x="112" y="240" width="128" height="144" rx="2" ry="2"/>
    <path fill="${PRIMARY_COLOR}" d="M320,480H288a32,32,0,0,1-32-32V64a32,32,0,0,1,32-32h32a32,32,0,0,1,32,32V448A32,32,0,0,1,320,480Z"/>
    <path fill="${PRIMARY_COLOR}" d="M495.89,445.45l-32.23-340c-1.48-15.65-16.94-27-34.53-25.31l-31.85,3c-17.59,1.67-30.65,15.71-29.17,31.36l32.23,340c1.48,15.65,16.94,27,34.53,25.31l31.85-3C484.31,475.14,497.37,461.1,495.89,445.45Z"/>
`;

async function generate() {
    // 1. App Icon (1024x1024)
    // Box: 768x768, Radius: 192, offset 128
    // Icon inside: 418x418 => scale 0.816, offset 303
    const iconSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" fill="${LIGHT_BG}" />
  <rect x="128" y="128" width="768" height="768" rx="192" ry="192" fill="${PRIMARY_COLOR}" fill-opacity="0.15" />
  <g transform="translate(303, 303) scale(0.816)">
    ${ioniconsPaths}
  </g>
</svg>`;

    // 2. Adaptive Icon Foreground (1024x1024)
    // Needs to fit in Android safe zone (~625 px)
    // Box: 600x600, Radius: 150, offset 212
    // Icon inside: 327x327 => scale 0.638, offset 348
    // NO background fill to let Android color through
    const adaptiveIconSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect x="212" y="212" width="600" height="600" rx="150" ry="150" fill="${PRIMARY_COLOR}" fill-opacity="0.15" />
  <g transform="translate(348, 348) scale(0.638)">
    ${ioniconsPaths}
  </g>
</svg>`;

    // 3. Splash Screen Image (1024x1024 as transparent foreground)
    // Same as icon but transparent background
    const splashSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect x="128" y="128" width="768" height="768" rx="192" ry="192" fill="${PRIMARY_COLOR}" fill-opacity="0.15" />
  <g transform="translate(303, 303) scale(0.816)">
    ${ioniconsPaths}
  </g>
</svg>`;

    console.log('Generating icon.png...');
    await sharp(Buffer.from(iconSvg))
        .png()
        .toFile(path.join(ASSETS_DIR, 'icon.png'));

    console.log('Generating adaptive-icon.png...');
    await sharp(Buffer.from(adaptiveIconSvg))
        .png()
        .toFile(path.join(ASSETS_DIR, 'adaptive-icon.png'));

    console.log('Generating splash.png...');
    await sharp(Buffer.from(splashSvg))
        .png()
        .toFile(path.join(ASSETS_DIR, 'splash.png'));

    console.log('Done!');
}

generate().catch(console.error);
