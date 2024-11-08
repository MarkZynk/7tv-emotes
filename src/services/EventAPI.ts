import WebSocket from 'ws';
import { GetChannelGQL } from './SevenTV.js';
import { Client, DispatchData, ListenMessage, RedisEmote } from '../types/index.js';

export class EventAPI {
	static instance: EventAPI;

	public pool: Map<number, Client> = new Map();
	private wsCount: number = 0;

	public activeTopics: Set<string> = new Set();

	public readonly maxSize = 400;
	public readonly uri = 'wss://events.7tv.io/v3';

	public static New(): EventAPI {
		return this.instance ?? (this.instance = new this());
	}

	createClient(): Promise<Client> {
		return new Promise((resolve) => {
			const client: Client = {
				ws: new WebSocket(this.uri),
				topics: new Set(),
				id: (this.wsCount += 1),
			};

			this.pool.set(client.id, client);

			client.ws.on('message', (data) => {
				this.handleMessage(data.toString());
			});

			client.ws.on('open', () => {
				resolve(client);
			});
		});
	}

	protected createListenMessage(topic: string): ListenMessage {
		return {
			op: 35,
			t: Date.now(),
			d: {
				type: topic.split(':')[0],
				condition: {
					object_id: topic.split(':')[1],
				},
			},
		};
	}

	async subscribe(subs: string[]) {
		for (const topic of subs) {
			let client = Array.from(this.pool.values()).find((c: Client) => c.topics.size < this.maxSize);

			if (!client) {
				client = await this.createClient();
			}

			if (!this.activeTopics.has(topic)) {
				const msg = this.createListenMessage(topic);
				client.ws.send(JSON.stringify(msg));
				client.topics.add(topic);
			}
		}
	}

	handleMessage(msg: string) {
		const data = JSON.parse(msg);

		switch (data.op) {
			case EventAPIMessageTypes.HELLO: {
				Bot.Logger.Log(`7TV Connected to EventAPI - session_id: ${data.d.session_id}`);
				break;
			}
			case EventAPIMessageTypes.DISPATCH: {
				// Dispatches
				this.handleDispatch(data.d);
				break;
			}
			case EventAPIMessageTypes.END:
			case EventAPIMessageTypes.RECONNECT: {
				// TODO: Reconnect request
				break;
			}
			case EventAPIMessageTypes.HEARTBEAT: {
				// TODO: Heartbeat, if 3 intervals are missed, reconnect
				break;
			}
			case EventAPIMessageTypes.ACK: {
				// Acknowledge subscriptions
				if (data.d.command === 'SUBSCRIBE') {
					const objID = data.d.data.condition.object_id || data.d.data.condition.id;
					const type = data.d.data.type;

					this.activeTopics.add(`${type}:${objID}`);
					Bot.Logger.Log(`Subscribed to event for ${type} ${objID}`);
				}

				break;
			}
			case EventAPIMessageTypes.UNSUBSCRIBE: {
				// TODO: Unsubscribe
				break;
			}
			case EventAPIMessageTypes.ERROR: {
				// Errors
				Bot.Logger.Error('7TV EventAPI:', data.d);
				break;
			}
			default: {
				// Unhandled
				Bot.Logger.Warn(`7tv EventAPI: ${msg}`);
			}
		}
	}

	async handleDispatch(data: DispatchData) {
		switch (data.type) {
			case 'emote_set.update': {
				const updateType = data.body.updated && data.body.updated.length > 0 ? data.body.updated[0]?.key : null
				if (updateType === 'capacity') return
				const stvId = data.body.id;
				const channel = await Bot.SQL.Query(`SELECT twitch_id FROM channels WHERE current_stv_set = $1`, [stvId]);
				const login = channel.rows[0].twitch_username;
				const id = channel.rows[0].twitch_id;

				let updatedEmotes: RedisEmote[] = [];

				// Get the emotes from redis
				const emotes = await Bot.Redis.getEmotes(id);
				if (emotes) {
					// Emote removed
					if (data.body.pulled && emotes) {
						updatedEmotes = emotes.filter(
							(emote) => emote.id !== data.body.pulled[0].old_value.id,
						);
					}

					// Emote added
					if (data.body.pushed && emotes) {
						const newEmote: RedisEmote = {
							name: data.body.pushed[0].value.data.name,
							alias: data.body.pushed[0].value.name,
							id: data.body.pushed[0].value.data.id,
						};
						updatedEmotes = [...emotes, newEmote];

						// If emote is not in db then add it
						const dbEmote = await Bot.SQL.Query(
							`SELECT emote, emote_id FROM emotes WHERE twitch_id = $1 AND emote_id = $2`,
							[id, newEmote.id],
						);

						if (dbEmote.rowCount === 0) {
							Bot.SQL.NewEmote(id, login, newEmote);
						}
					}

					// Emoted renamed
					if (data.body.updated && emotes) {
						const i = emotes.findIndex(
							(emote) => emote.id === data.body.updated[0].value.data.id,
						);

						if (i >= 0) {
							// Update emote in db
							Bot.SQL.UpdateEmote({
								dbName: emotes[i].name,
								dbAlias: emotes[i].alias,
								name: data.body.updated[0].value.data
									.name,
								alias: data.body.updated[0].value.name,
								id: data.body.updated[0].value.id,
								channelId: id,
								channelName: login,
							});

							// Update emote in redis
							emotes[i].alias = data.body.updated[0].value.name;
						}

						updatedEmotes = [...emotes];
					}

					// Set the new array of emotes in redis
					Bot.Redis.setEmotes(id, updatedEmotes);
				}
				break;
			}
			case 'user.update': {
				if (!data.body.updated) return;

				const updateType = data.body.updated[0]?.value[1]?.key;

				if (['emote_set_id', 'emote_set'].includes(updateType)) {
					const stvId = data.body.id;
					const newSetId = data.body.updated[0].value[1].value;

					// Sub to new set
					this.subscribe([`emote_set.update:${newSetId}`]);

					// Get emote info for the new current set
					const stvChannel = await GetChannelGQL(stvId);

					if (stvChannel) {
						const newSetEmotes = stvChannel.emote_set.emotes.map((emote) => ({
							name: emote.data.name,
							alias: emote.name,
							id: emote.id,
						}));

						const channel = await Bot.SQL.Query(
							`SELECT twitch_id FROM channels WHERE stv_id = $1`,
							[stvId],
						);

						// Update emotes in redis
						Bot.Redis.setEmotes(channel.rows[0].twitch_id, newSetEmotes);
					}

					// Update current set in db
					Bot.SQL.Query(
						`UPDATE channels
                        SET current_stv_set = $2
                        WHERE stv_id = $1`,
						[stvId, newSetId],
					);
				}
				break;
			}
			default: {
				Bot.Logger.Warn(`Unhandled 7TV EventAPI Dispatch: ${JSON.stringify(data)}`);
			}
		}
	}
}

enum EventAPIMessageTypes {
	DISPATCH = 0,
	HELLO = 1,
	HEARTBEAT = 2,
	RECONNECT = 4,
	ACK = 5,
	ERROR = 6,
	END = 7,
	IDENTIFY = 33,
	RESUME = 34,
	SUBSCRIBE = 35,
	UNSUBSCRIBE = 36,
	SIGNAL = 37,
}
