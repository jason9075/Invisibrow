import { BrowserAgent } from './agent';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function main() {
  const agent = new BrowserAgent();
  const arg = process.argv[2] || '幫我查今天台北的天氣。';

  // 檢查是否為手動登入模式
  if (process.env.LOGIN_MODE === 'true') {
    const url = arg.startsWith('http') ? arg : 'https://discord.com/login';
    console.log(`🔑 進入手動登入模式: ${url}`);
    
    try {
      await agent.init();
      // 在 init 後手動導航，避免進入 solve 循環
      const page = await (agent as any).page;
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const rl = readline.createInterface({ input, output });
      console.log('\n👉 請在瀏覽器視窗中完成登入/掃描 QR Code。');
      await rl.question('👉 完成後，請回到此處按下 [Enter] 鍵關閉瀏覽器並儲存 Session...');
      rl.close();
      
      console.log('✅ Session 已儲存。');
    } catch (error) {
      console.error('❌ 登入模式發生錯誤:', error);
    } finally {
      await agent.close();
    }
    return;
  }

  // 標準 AI 模式
  console.log(`🎯 目標: ${arg}`);

  try {
    const result = await agent.solve(arg);
    console.log('\n--- 🏁 任務達成 ---');
    console.log(result);
    console.log('------------------\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await agent.close();
  }
}

main();
