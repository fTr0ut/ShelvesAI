import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const ASSETS_DIR = path.resolve('./assets');
const WEB_APP_ICON = path.resolve('./../website/public/logo-v2.png');
const WEB_ANDROID_ICON = path.resolve('./../website/public/logo-android.png');
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
    // 3. Splash Screen Image (1024x1024 as transparent foreground)
    // Same as icon but transparent background
    const splashSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect x="128" y="128" width="768" height="768" rx="192" ry="192" fill="${PRIMARY_COLOR}" fill-opacity="0.15" />
  <g transform="translate(303, 303) scale(0.816)">
    ${ioniconsPaths}
  </g>
</svg>`;

    console.log('Syncing icon.png from website/public/logo-v2.png...');
    await sharp(WEB_APP_ICON)
        .png()
        .toFile(path.join(ASSETS_DIR, 'icon.png'));

    console.log('Syncing adaptive-icon.png from website/public/logo-android.png...');
    await sharp(WEB_ANDROID_ICON)
        .png()
        .toFile(path.join(ASSETS_DIR, 'adaptive-icon.png'));

    console.log('Syncing logo-android.png from website/public/logo-android.png...');
    await sharp(WEB_ANDROID_ICON)
        .png()
        .toFile(path.join(ASSETS_DIR, 'logo-android.png'));

    console.log('Generating splash.png...');
    await sharp(Buffer.from(splashSvg))
        .png()
        .toFile(path.join(ASSETS_DIR, 'splash.png'));

    console.log('Done!');
}

generate().catch(console.error);
