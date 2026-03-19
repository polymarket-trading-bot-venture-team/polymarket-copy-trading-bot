import { loadSettings } from "./config.js";
import { CopyTradingBot } from "./src/bot.js";
import { logFatal } from "./src/log.js";

const settings = loadSettings();
const bot = new CopyTradingBot(settings);
bot.run().catch((e) => {
  logFatal(e);
  process.exit(1);
});
