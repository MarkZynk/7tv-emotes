export type Config = {
	Postgres: {
		password: string;
		user: string;
		host: string;
		port: number;
		database: string;
	};
	Twitch: {
		username: string;
		oauth: string;
		clientId: string;
		clientSecret: string;
	};
	DEBUG: boolean;
	TRANSFER: boolean;
	API: {
		port: number;
		authKey: string;
	};
	WS: {
		port: number;
	};
	Admins: string[];
	BatchSize: number;
};

export type NewEmote = {
	id: string;
	alias: string | null;
	name: string;
};

export type UpdateEmote = {
	dbName: string;
	dbAlias: string;
	name: string;
	alias: string | null;
	id: string;
	channelId: string;
	channelName: string;
};

export type IChannels = {
	count: number;
};

export interface GlobalClasses {
	Config: Config;
	Twitch: import('../services/TwitchClient').ChatClient;
	SQL: import('../database/Postgres').Postgres;
	Redis: import('../database/Redis').RedisClient;
	Logger: import('./utils/Logger').Logger;
  EventAPI: import('../services/EventAPI').EventAPI;
	WS: import('./services/Websocket').Websocket;
	Cronjob: import('../utility/Cronjob').Cronjob;
	EmoteHandler: import('../handler/EmoteHandler').EmoteHandler;
}