import { BrowserAgent } from './agent';

async function main() {
  const agent = new BrowserAgent();
  const targetUrl = process.argv[2] || 'https://www.google.com';
  const query = process.argv[3] || '這個網頁是在做什麼的？';

  try {
    await agent.init();
    await agent.goto(targetUrl);
    
    const result = await agent.analyze(query);
    console.log('\n--- AI 分析結果 ---');
    console.log(result);
    console.log('-------------------\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await agent.close();
  }
}

main();
