import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import fs from 'node:fs';
import path from 'node:path';

/** 编译 mp-weixin 后将云函数目录复制到产物，供微信开发者工具识别上传 */
function copyCloudFunctions() {
  return {
    name: 'copy-cloudfunctions',
    writeBundle() {
      if (process.env.UNI_PLATFORM !== 'mp-weixin') return;
      const src = path.resolve(process.cwd(), 'cloudfunctions');
      const outDir = path.resolve(
        process.cwd(),
        'dist',
        process.env.NODE_ENV === 'production' ? 'build' : 'dev',
        'mp-weixin',
      );
      if (!fs.existsSync(src) || !fs.existsSync(outDir)) return;
      fs.cpSync(src, path.join(outDir, 'cloudfunctions'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [uni(), copyCloudFunctions()],
});
