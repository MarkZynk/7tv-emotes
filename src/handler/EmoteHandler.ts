import type { PrivmsgMessage } from '@kararty/dank-twitch-irc';

type AccumulatedBatch = [string, string, number][]; // [channelID, id, count]

export class EmoteHandler {
	private static instance: EmoteHandler;

	private readonly batchSize: number;
	private readonly accumulation: AccumulatedBatch;

	constructor() {
		if (EmoteHandler.instance) {
			throw new Error('Use EmoteHandler.New() to get an instance of EmoteHandler');
		}

		this.batchSize = Bot.Config.BatchSize ?? 100;
		this.accumulation = [];
	}

	static New(): EmoteHandler {
		if (!this.instance) {
			this.instance = new EmoteHandler();
		}

		return this.instance;
	}

	public async handleEmote(msg: PrivmsgMessage): Promise<void> {
		const get = await Bot.Redis.getEmotes(msg.channelID);
		const emoteNameMap: Map<string, [string, string, number]> = new Map();
	
		for (const word of msg.messageText.split(' ')) {
			for (const emote of get) {
				const usedAlias = emote.alias === emote.name ? emote.name : emote.alias;
				if (usedAlias === word) {
					if (!emoteNameMap.has(emote.name)) {
						emoteNameMap.set(emote.name, [emote.alias, emote.id, 0]);
					}
	
					emoteNameMap.get(emote.name)![2]++;
				}
			}
		}
	
		if (emoteNameMap.size === 0) return;
	
		for (const [name, [alias, id, count]] of emoteNameMap.entries()) {
			this.accumulate(msg.channelID, id, count);
	
			Bot.WS.Send(msg.channelID, {
				type: 'emote',
				channelName: msg.channelName,
				channelId: msg.channelID,
				senderName: msg.senderUsername,
				senderId: msg.senderUserID,
				data: {
					name,
					alias,
					id,
					count,
				},
			});
	
			Bot.Logger.Debug(
				`Emote ${name} (${id}) used ${count} times in ${msg.channelName}` +
				` - Accumulation: ${this.accumulation.length}`
			);
	
			Bot.Logger.Debug(
				`${process.memoryUsage().rss / 1024 / 1024} MB` +
				`, ${process.memoryUsage().heapUsed / 1024 / 1024} MB`
			);
		}
	}
	
  private async accumulate(channelID: string, id: string, count: number): Promise<void> {
		this.accumulation.push([channelID, id, count]);
	
		if (this.accumulation.length < this.batchSize) return;
		
		const batchData = new Map<string, number>();
	
		for (const [channelID, emoteID, count] of this.accumulation) {
			const key = `${channelID}:${emoteID}`;
			batchData.set(key, (batchData.get(key) ?? 0) + count);
		}
	
		this.accumulation.length = 0; 
	
		const twitchIDs: string[] = [];
		const emoteIDs: string[] = [];
		const counts: number[] = [];
	
		for (const [key, count] of batchData.entries()) {
			const [channelID, emoteID] = key.split(':');
			twitchIDs.push(channelID);
			emoteIDs.push(emoteID);
			counts.push(count);
		}
	
		Bot.Logger.Debug(`Inserting batch of ${twitchIDs.length} 7TV emotes into the database`);
		
		const t1 = performance.now();
		const values = [twitchIDs, emoteIDs, counts];
		const query = 
			`UPDATE emotes 
			 SET emote_count = emote_count + data.count
			 FROM (SELECT UNNEST($1::VARCHAR[]) AS twitch_id, 
										UNNEST($2::VARCHAR[]) AS emote_id, 
										UNNEST($3::INT[]) AS count) AS data
			 WHERE emotes.twitch_id = data.twitch_id
			 AND emotes.emote_id = data.emote_id;`

		const result = await Bot.SQL.Query(query, values);
		const t2 = performance.now();
		const duration = (t2 - t1).toFixed(2);
		if (result.rowCount !== twitchIDs.length) {
			return Bot.Logger.Error(
				`Failed to insert batch of emotes into the database - Took: ${duration}ms`
			);
		} 

		Bot.Logger.Debug(
			`Batch of ${twitchIDs.length} 7TV emotes inserted into the database - Took: ${duration}ms`
		);
	}
}
