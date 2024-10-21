import pkg from 'pg';
import config from '../../src/config.json' with { type: 'json'};

const client = new pkg.Pool({
	password: config.Postgres.password,
	user: config.Postgres.user,
	host: config.Postgres.host,
	port: config.Postgres.port,
	database: config.Postgres.database,
});

const GQL = 'https://7tv.io/v3/gql';

const splitArray = (arr, len) => {
	const chunks = [];
	let i = 0;
	const n = arr.length;

	while (i < n) {
		chunks.push(arr.slice(i, (i += len)));
	}

	return chunks;
};

const emotes = async () => {
	try {
		const ids = (await client.query('SELECT emote_id FROM emotes')).rows;

		const batches = splitArray(ids, 200);

		console.log(`Starting emotes migration with ${ids.length} entries, split into ${batches.length} batches`);

		for (const batch of batches) {
			try {
				const inputs = batch.map((_, index) => `$e${index}: ObjectID!`).join(' ');

				const aliases = batch.map((_, index) => `e${index}: emote(id: $e${index}) { id }`).join(' ');

				const variables = batch.reduce((acc, emote, index) => {
					acc[`e${index}`] = emote.emote_id;
					return acc;
				}, {});

				const gqlQuery = { query: `query (${inputs}) { ${aliases} }`, variables };

				const gqlResult = await (
					await fetch(GQL, {
						method: 'POST',
						body: JSON.stringify(gqlQuery),
					})
				).json();

				const updates = Object.keys(gqlResult.data)
					.map((key, i) => ({ oldId: batch[i], newId: gqlResult.data[key]?.id }))
					.filter((update) => update.newId);

				for (const { oldId, newId } of updates) {
					await client.query(`UPDATE emotes SET emote_id = $1 WHERE emote_id = $2`, [newId, oldId.emote_id]);
				}

				console.log(`Processed batch with ${batch.length} entries`);
			} catch (error) {
				console.log(`Error during emotes batch #${batches.indexOf(batch)}`, error);
			}
		}

		console.log('Emotes migration complete!');
	} catch (error) {
		console.log('Error during emotes migration:', error);
	}
};

const channels = async () => {
	try {
		const ids = (await client.query('SELECT stv_id FROM channels')).rows;

		const batches = splitArray(ids, 200);

		console.log(`Starting channel migration with ${ids.length} entries, split into ${batches.length} batches`);

		for (const batch of batches) {
			try {
				const inputs = batch.map((_, index) => `$e${index}: ObjectID!`).join(' ');

				const aliases = batch.map((_, index) => `e${index}: user(id: $e${index}) { id }`).join(' ');

				const variables = batch.reduce((acc, user, index) => {
					acc[`e${index}`] = user.stv_id;
					return acc;
				}, {});

				const gqlQuery = { query: `query (${inputs}) { ${aliases} }`, variables };

				const gqlResult = await (
					await fetch(GQL, {
						method: 'POST',
						body: JSON.stringify(gqlQuery),
					})
				).json();

				const updates = Object.keys(gqlResult.data)
					.map((key, i) => ({ oldId: batch[i], newId: gqlResult.data[key]?.id }))
					.filter((update) => update.newId);

				for (const { oldId, newId } of updates) {
					await client.query(`UPDATE channels SET stv_id = $1 WHERE stv_id = $2`, [newId, oldId.stv_id]);
				}

				console.log(`Processed batch with ${batch.length} entries`);
			} catch (error) {
				console.log(`Error during channels batch #${batches.indexOf(batch)}`, error);
			}
		}

		console.log('Channel migration complete!');
	} catch (error) {
		console.log('Error during channel migration:', error);
	}
};

const emoteSets = async () => {
	try {
		const ids = (await client.query('SELECT current_stv_set FROM channels')).rows;

		const batches = splitArray(ids, 200);

		console.log(`Starting emote sets migration with ${ids.length} entries, split into ${batches.length} batches`);

		for (const batch of batches) {
			try {
				const inputs = batch.map((_, index) => `$e${index}: ObjectID!`).join(' ');

				const aliases = batch.map((_, index) => `e${index}: emoteSet(id: $e${index}) { id }`).join(' ');

				const variables = batch.reduce((acc, channel, index) => {
					acc[`e${index}`] = channel.current_stv_set;
					return acc;
				}, {});

				const gqlQuery = { query: `query (${inputs}) { ${aliases} }`, variables };

				const gqlResult = await (
					await fetch(GQL, {
						method: 'POST',
						body: JSON.stringify(gqlQuery),
					})
				).json();

				const updates = Object.keys(gqlResult.data)
					.map((key, i) => ({ oldId: batch[i], newId: gqlResult.data[key]?.id }))
					.filter((update) => update.newId);

				for (const { oldId, newId } of updates) {
					await client.query(`UPDATE channels SET current_stv_set = $1 WHERE current_stv_set = $2`, [
						newId,
						oldId.current_stv_set,
					]);
				}

				console.log(`Processed batch with ${batch.length} entries`);
			} catch (error) {
				console.log(`Error during emote sets batch #${batches.indexOf(batch)}`, error);
			}
		}

		console.log('Emote sets migration complete!');
	} catch (error) {
		console.log('Error during emote sets migration:', error);
	}
};

emotes();
channels();
emoteSets();
