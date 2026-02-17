import { exec } from 'child_process';
import { log } from './logger';

/**
 * 使用 OSC 52 協定將文字複製到剪貼簿 (跨 SSH、無須外部依賴)
 */
const copyToClipboardOSC52 = (text: string): boolean => {
  try {
    const base64 = Buffer.from(text).toString('base64');
    const osc52 = `\x1b]52;c;${base64}\x07`;
    process.stdout.write(osc52);
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * 嘗試使用系統指令複製 (wl-copy, xclip)
 */
const copyWithSystemTools = async (text: string): Promise<boolean> => {
  return new Promise((resolve) => {
    // 優先嘗試 wl-copy (Wayland)
    exec(`echo -n "${text}" | wl-copy`, (err) => {
      if (!err) return resolve(true);
      
      // 次之嘗試 xclip (X11)
      exec(`echo -n "${text}" | xclip -selection clipboard`, (err) => {
        if (!err) return resolve(true);
        resolve(false);
      });
    });
  });
};

/**
 * 執行開啟 URL (xdg-open)
 */
export const openUrl = (url: string) => {
  if (!url) return;
  const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${cmd} "${url}"`, (err) => {
    if (err) {
      log(`無法開啟 URL: ${err.message}`, 'error');
    }
  });
};

/**
 * 整合複製函式
 */
export const copyToClipboard = async (text: string) => {
  if (!text) return;
  
  // 1. 先用 OSC 52 (最快且無依賴)
  copyToClipboardOSC52(text);
  
  // 2. 同步嘗試系統工具 (確保在一些不支援 OSC 52 的終端機也能運作)
  const success = await copyWithSystemTools(text);
  
  if (success) {
    log(`[System] URL 已複製到剪貼簿`);
  } else {
    log(`[System] OSC 52 已發送 (若未複製成功請檢查終端機設定)`);
  }
};
