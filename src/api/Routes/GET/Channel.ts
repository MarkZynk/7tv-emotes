import Express, { Request, Response } from 'express';
import { Limiter } from '../../Middleware/RateLimit.js';
import { IVR } from '../../../services/IVR.js';
const Router = Express.Router();

type Emote = {
	emote: string;
	emote_alias: string | null;
	emote_id: string;
	emote_count: number;
	added: Date;
};

async function handleChannelEmotes(req: Request, res: Response) {
	try {
		const username = req.params.username ?? (req.query.username as string);

		const limit = req.query.limit as string;
		if (limit && Number.isNaN(parseInt(limit))) {
			return res.status(400).json({
				success: false,
				message: 'Invalid limit parameter',
			});
		}
    
		const order = req.query.order as string;
		if (order && !['asc', 'desc'].includes(order.toLowerCase())) {
			return res.status(400).json({
				success: false,
				message: 'Invalid order parameter',
			});
		}

		let data: Record<any, any> | null = {};

		if (req.query.id) {
			data.id = req.query.id as string;
		} else {
			data = await IVR(username);
		}

		if (!data?.id) {
			return res.status(404).json({
				success: false,
				message: 'Channel not found',
			});
		}

		const [channelData, channelEmotes] = await Promise.all([
			Bot.SQL.Query(`SELECT * FROM channels WHERE twitch_id = $1`, [data.id]),
			Bot.SQL.Query(
				`SELECT e.*
				 FROM ( SELECT * FROM channels WHERE twitch_id = $1 ) AS c
				 INNER JOIN emotes AS e ON e.twitch_id = c.twitch_id
				 ORDER BY e.emote_count ${order ? order.toUpperCase() : 'DESC'}
				 ${limit ? `LIMIT ${limit}` : ''}`,
				[data.id],
			),
		]);

		if (channelEmotes.rowCount === 0 || channelData.rowCount === 0) {
			return res.status(404).json({
				success: false,
				message: 'No emotes found for this channel',
			});
		}

		const emotes = channelEmotes.rows.map((emote: Emote) => {
			return {
				id: emote.emote_id,
				name: emote.emote,
				alias: emote.emote_alias,
				count: emote.emote_count,
				since: emote.added,
			};
		});

		return res.status(200).json({
			success: true,
			channel: {
				id: channelData.rows[0].twitch_id,
				/** @todo store usernames and auto update on an interval instead of IVR requests? */
				login: !req.query.id ? data.login : null,
				stvId: channelData.rows[0].stv_id,
				since: channelData.rows[0].tracking_since,
				tracking: channelData.rows[0].tracking,
			},
			emotes,
		});
	} catch (e: any) {
		Bot.Logger.Error(`[API] ${e.message}`);
		return res.status(500).json({
			success: false,
			message: 'Internal Server Error',
		});
	}
}

Router.get('/c/:username', Limiter(1000, 10), handleChannelEmotes);
Router.get('/c', Limiter(1000, 10), handleChannelEmotes);

export default Router;
