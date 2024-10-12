import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Postgres } from './database/Postgres.js';
import { RedisClient } from './database/Redis.js';
import { Logger } from './utility/Logger.js';
import { ChatClient } from './services/TwitchClient.js';
import { WebsocketServer } from './manager/WebSocketManager.js';
import { ChannelEmoteManager } from './manager/ChannelEmoteManager.js';
import { Cronjob } from './utility/Cronjob.js';
import { IVR } from './services/IVR.js';
import { EmoteHandler } from './handler/EmoteHandler.js';
import { GlobalClasses } from './types/types.js';
import { GetChannelsInfo } from './services/SevenTV.js';
import { EventAPI } from './services/EventAPI.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, 'config.json');

let Bot = global.Bot = {} as GlobalClasses;

// @ts-expect-error CBA to fix top level await in tsconfig
Bot.Config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
Bot.Logger = Logger.New();
Bot.Twitch = new ChatClient();
Bot.Redis = RedisClient.New();
Bot.WS = new WebsocketServer(Bot.Config.WS.port);
Bot.Cronjob = Cronjob.New();
Bot.EmoteHandler = EmoteHandler.New();
Bot.EventAPI = EventAPI.New();

(async () => {
	await Postgres.Setup();

	Bot.SQL = Postgres.New();
	await Bot.SQL.CreateTables();

	await import('./api/index.js');

	process.on('SIGINT', async () => {
		await Bot.Redis.delAll();
		Bot.Logger.Warn('Shutting down...');
		process.exit();
	});

	process.once('SIGUSR2', async () => {
		await Bot.Redis.delAll();
		Bot.Logger.Warn('Shutting down...');
		process.kill(process.pid, 'SIGUSR2');
	});

	process.on('uncaughtException', (err) => {
		Bot.Logger.Error(`uncaughtException: ${err}`);
	});

	const joinChannels = async (): Promise<void> => {
		for (const channelId of Bot.Config.Admins) {
			try {
				const data = await IVR(channelId, true);
				if (data) Bot.Twitch.Join(data.login);
			} catch (e) {
				Bot.Logger.Error(`Failed to join admin channel: ${channelId}`);
			}
		}

		const channels = await Bot.SQL.GetChannelsToJoin();
		for (const channel of channels) {
			try {
				Bot.Twitch.Join(channel);
			} catch (e) {
				Bot.Logger.Error(`Failed to join channel.login: ${channel}`);
			}
		}
	};

	const Init = async () => {
		joinChannels();

		const gettingChannelInfo: number = performance.now();
		// When we start the bot we want to get all the 7tv information in case we missed anything from EventAPI
		const channelsInfo = await GetChannelsInfo();
		Bot.Logger.Log(`Got channel info for ${channelsInfo.length} channels, took ${performance.now() - gettingChannelInfo}ms`);

		const updatingChannels: number = performance.now();
		// Use that info to update channels
		const count = await ChannelEmoteManager(channelsInfo);
		Bot.Logger.Log(`Emotes updated for ${count}/${channelsInfo.length} channels, took ${performance.now() - updatingChannels}ms`);
	};

	await Init();
	Bot.Cronjob.Schedule('0 */2 * * *', async () => {
		joinChannels();
	});
})();
