import fs from 'fs';
import path from 'path';
import os from 'os';

export interface InvisibrowConfig {
  models: {
    browserAgent: string;
    auditorAgent: string;
  };
}

const DEFAULT_CONFIG: InvisibrowConfig = {
  models: {
    browserAgent: 'gpt-4o',
    auditorAgent: 'gpt-4o-mini', // "nano" equivalent in OpenAI
  }
};

export function getConfig(): InvisibrowConfig {
  const configPath = path.join(os.homedir(), '.config', 'invisibrow.json');
  
  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(content);
    return {
      models: {
        ...DEFAULT_CONFIG.models,
        ...userConfig.models
      }
    };
  } catch (error) {
    console.error(`Error reading config at ${configPath}:`, error);
    return DEFAULT_CONFIG;
  }
}
