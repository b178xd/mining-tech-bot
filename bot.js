
require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    REST,
    Routes,
    ApplicationCommandOptionType,
    PermissionFlagsBits
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    EndBehaviorType,
    StreamType
} = require('@discordjs/voice');

const prism = require('prism-media');
const { Readable } = require('node:stream');
const express = require('express');

// ==========================================
// CONFIGURATION
// ==========================================

const app = express();

app.get('/', (req, res) => {
    res.send('Mining Tech Bot + Mister T9 Online!');
});

app.listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const TRACKER_CHANNEL_ID =
    process.env.TRACKER_CHANNEL_ID || '1403313906906173480';

const linkedPlayers = [
    'a678xd',
    'Ahmds_19',
    'windowss134'
];

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const AI_MODEL = 'gpt-4o-mini';
const TTS_MODEL = 'tts-1';
const TTS_VOICE = 'onyx';

const voiceSessions = new Map();
const processingUsers = new Set();

const wikiApis = [
    'https://en.wikipedia.org/w/api.php',
    process.env.FANDOM_API_URL,
    process.env.OTHER_WIKI_API_URL,
    ...(process.env.WIKI_API_URLS || '').split(',')
]
    .filter(Boolean)
    .map(url => url.trim())
    .filter((url, index, array) => array.indexOf(url) === index);

// ==========================================
// CHECK CONFIGURATION
// ==========================================

if (!process.env.DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN is missing!');
}

if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing!');
}

// ==========================================
// WIKI SEARCH
// ==========================================

async function searchWiki(apiUrl, query) {
    const url = new URL(apiUrl);

    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', '4');
    url.searchParams.set('format', 'json');

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'MiningTechMisterT9/2.0 (Discord Bot)'
        },
        signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
        throw new Error(`Wiki HTTP ${response.status}`);
    }

    const data = await response.json();

    return (data.query?.search || []).map(page => ({
        title: page.title,
        snippet: page.snippet.replace(/<[^>]*>/g, ''),
        url: new URL(
            '/wiki/' + encodeURIComponent(
                page.title.replace(/ /g, '_')
            ),
            url.origin
        ).href
    }));
}

async function searchAllWikis(query) {
    const results = await Promise.all(
        wikiApis.map(async api => {
            try {
                return {
                    wiki: new URL(api).hostname,
                    pages: await searchWiki(api, query)
                };
            } catch (error) {
                console.error('Wiki error:', api, error.message);

                return {
                    wiki: api,
                    pages: []
                };
            }
        })
    );

    return results;
}

// ==========================================
// AI QUESTION ANSWERING
// ==========================================

async function askMisterT9(question) {
    const wikiResults = await searchAllWikis(question);

    const pages = wikiResults.flatMap(result =>
        result.pages.map(page => ({
            ...page,
            wiki: result.wiki
        }))
    );

    const context = pages.map(page => `
WIKI: ${page.wiki}
TITLE: ${page.title}
INFORMATION: ${page.snippet}
SOURCE: ${page.url}
`).join('\n').slice(0, 14000);

    const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: `
You are MISTER T9.

You are a robotic sci-fi gaming assistant.

Answer questions clearly and naturally.

Use the supplied wiki research when available.
Never invent wiki facts or pretend you found sources
that you did not find.

If sources disagree, explain that.

If no sources are found, say so.

Keep spoken answers relatively short.
Do not read URLs aloud.
`
                    },
                    {
                        role: 'user',
                        content: `
QUESTION:
${question}

WIKI RESEARCH:
${context || 'No wiki search results found.'}

Answer the question.
`
                    }
                ],
                max_tokens: 350,
                temperature: 0.5
            })
        }
    );

    if (!response.ok) {
        throw new Error(
            `AI error: ${await response.text()}`
        );
    }

    const data = await response.json();

    return {
        answer:
            data.choices?.[0]?.message?.content ||
            'I cannot answer that right now.',
        sources: pages.slice(0, 8)
    };
}

// ==========================================
// SPEECH RECOGNITION
// ==========================================

function createWav(pcm) {
    const header = Buffer.alloc(44);

    const sampleRate = 48000;
    const channels = 2;
    const bits = 16;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);

    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);

    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(192000, 28);

    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(bits, 34);

    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);

    return Buffer.concat([header, pcm]);
}

async function transcribeAudio(pcm) {
    const wav = createWav(pcm);

    const form = new FormData();

    form.append(
        'file',
        new Blob([wav], { type: 'audio/wav' }),
        'mister-t9.wav'
    );

    form.append('model', 'whisper-1');

    const response = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`
            },
            body: form
        }
    );

    if (!response.ok) {
        throw new Error(
            `Transcription error: ${await response.text()}`
        );
    }

    const data = await response.json();

    return data.text || '';
}

// ==========================================
// ROBOTIC TEXT TO SPEECH
// ==========================================

async function generateSpeech(text) {
    const response = await fetch(
        'https://api.openai.com/v1/audio/speech',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: TTS_MODEL,
                voice: TTS_VOICE,
                input: text.slice(0, 4000),
                response_format: 'mp3',
                speed: 0.95
            })
        }
    );

    if (!response.ok) {
        throw new Error(
            `TTS error: ${await response.text()}`
        );
    }

    return Buffer.from(await response.arrayBuffer());
}

// ==========================================
// VOICE PLAYBACK QUEUE
// ==========================================

async function speak(guildId, text) {
    const session = voiceSessions.get(guildId);

    if (!session) return;

    try {
        const audio = await generateSpeech(text);

        const current = voiceSessions.get(guildId);

        if (!current) return;

        current.queue.push(audio);

        if (
            current.player.state.status === AudioPlayerStatus.Idle
        ) {
            playNext(guildId);
        }
    } catch (error) {
        console.error('Speech error:', error);
    }
}

function playNext(guildId) {
    const session = voiceSessions.get(guildId);

    if (!session || session.queue.length === 0) return;

    const audio = session.queue.shift();

    const resource = createAudioResource(
        Readable.from([audio]),
        {
            inputType: StreamType.Arbitrary
        }
    );

    session.player.play(resource);
}

// ==========================================
// PROCESS QUESTIONS
// ==========================================

async function processQuestion(guildId, question, textChannel) {
    const session = voiceSessions.get(guildId);

    if (!session) return;

    try {
        const result = await askMisterT9(question);

        if (!voiceSessions.has(guildId)) return;

        const answer = result.answer;

        if (textChannel) {
            const embed = new EmbedBuilder()
                .setTitle('🤖 Mister T9')
                .setDescription(answer.slice(0, 4000))
                .setColor(0x00FFCC);

            if (result.sources.length) {
                embed.addFields({
                    name: '📚 Wiki sources',
                    value: result.sources
                        .slice(0, 5)
                        .map(source =>
                            `[${source.wiki}: ${source.title}](${source.url})`
                        )
                        .join('\n')
                        .slice(0, 1000)
                });
            }

            await textChannel.send({ embeds: [embed] });
        }

        await speak(guildId, answer);

    } catch (error) {
        console.error('Question error:', error);

        await speak(
            guildId,
            'My research systems are temporarily unavailable.'
        );
    }
}

// ==========================================
// VOICE RECOGNITION AND WAKE PHRASE
// ==========================================

function startListening(guildId, textChannel) {
    const session = voiceSessions.get(guildId);

    if (!session) return;

    const receiver = session.connection.receiver;

    receiver.speaking.on('start', userId => {
        if (!voiceSessions.has(guildId)) return;

        if (userId === client.user.id) return;

        if (processingUsers.has(`${guildId}:${userId}`)) return;

        processingUsers.add(`${guildId}:${userId}`);

        const opusStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 900
            }
        });

        const decoder = new prism.opus.Decoder({
            rate: 48000,
            channels: 2,
            frameSize: 960
        });

        const chunks = [];

        let finished = false;

        const cleanup = () => {
            if (finished) return;
            finished = true;

            processingUsers.delete(`${guildId}:${userId}`);

            opusStream.destroy();
            decoder.destroy();
        };

        opusStream
            .pipe(decoder)
            .on('data', chunk => {
                if (
                    Buffer.concat(chunks).length + chunk.length >
                    8 * 1024 * 1024
                ) {
                    cleanup();
                    return;
                }

                chunks.push(chunk);
            })
            .on('end', async () => {
                if (finished) return;

                const pcm = Buffer.concat(chunks);

                cleanup();

                if (pcm.length < 10000) return;

                try {
                    const transcript = await transcribeAudio(pcm);

                    if (!voiceSessions.has(guildId)) return;

                    const normalized = transcript
                        .toLowerCase()
                        .replace(/[.,!?]/g, '')
                        .trim();

                    const wakePhrase = 'hey mister t9';

                    const wakeIndex = normalized.indexOf(wakePhrase);

                    if (wakeIndex !== -1) {
                        const sessionNow = voiceSessions.get(guildId);

                        if (!sessionNow) return;

                        const remaining = transcript
                            .slice(wakeIndex + wakePhrase.length)
                            .trim();

                        sessionNow.activeUntil =
                            Date.now() + 30000;

                        await speak(guildId, 'What?');

                        if (remaining.length > 3) {
                            await processQuestion(
                                guildId,
                                remaining,
                                textChannel
                            );
                        }

                        return;
                    }

                    const current = voiceSessions.get(guildId);

                    if (
                        current &&
                        Date.now() < current.activeUntil &&
                        normalized.length > 3
                    ) {
                        current.activeUntil = 0;

                        await processQuestion(
                            guildId,
                            transcript,
                            textChannel
                        );
                    }

                } catch (error) {
                    console.error('Voice recognition error:', error);
                }
            })
            .on('error', error => {
                console.error('Audio stream error:', error);
                cleanup();
            });
    });
}

// ==========================================
// DISCORD VOICE SESSION
// ==========================================

async function joinT9(voiceChannel, textChannel) {
    const guildId = voiceChannel.guild.id;

    if (voiceSessions.has(guildId)) {
        throw new Error('Mister T9 is already connected.');
    }

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,

        selfDeaf: false,
        selfMute: false
    });

    const player = createAudioPlayer();

    connection.subscribe(player);

    const session = {
        connection,
        player,
        queue: [],
        activeUntil: 0,
        textChannel
    };

    voiceSessions.set(guildId, session);

    player.on(AudioPlayerStatus.Idle, () => {
        playNext(guildId);
    });

    player.on('error', error => {
        console.error('Audio player error:', error);
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
        voiceSessions.delete(guildId);
    });

    try {
        await entersState(
            connection,
            VoiceConnectionStatus.Ready,
            30000
        );

        startListening(guildId, textChannel);

        await textChannel.send(
            '🤖 **Mister T9 is online!** Voice listening is active. ' +
            'The bot receives speech from this channel after the wake phrase ' +
            '`Hey Mister T9!`. Use `/t9 leave` to stop listening.'
        );

        await speak(
            guildId,
            'Mister T9 systems online. What?'
        );

    } catch (error) {
        voiceSessions.delete(guildId);
        connection.destroy();
        throw error;
    }
}

// ==========================================
// SLASH COMMAND REGISTRATION
// ==========================================

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);

    const commands = [
        {
            name: 'ore',
            description: 'Search configured wikis for an ore',
            options: [
                {
                    name: 'name',
                    type: ApplicationCommandOptionType.String,
                    description: 'Ore name',
                    required: true
                }
            ]
        },
        {
            name: 't9',
            description: 'Control Mister T9 voice assistant',
            options: [
                {
                    name: 'action',
                    description: 'Choose an action',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: 'Join voice', value: 'join' },
                        { name: 'Leave voice', value: 'leave' }
                    ]
                }
            ]
        }
    ];

    try {
        const rest = new REST({ version: '10' })
            .setToken(process.env.DISCORD_TOKEN);

        const guilds = await client.guilds.fetch();

        for (const [guildId] of guilds) {
            await rest.put(
                Routes.applicationGuildCommands(
                    client.user.id,
                    guildId
                ),
                { body: commands }
            );
        }

        console.log('✅ Slash commands registered.');
    } catch (error) {
        console.error('Command registration error:', error);
    }
});

// ==========================================
// SLASH COMMAND HANDLER
// ==========================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // ORE COMMAND
    if (interaction.commandName === 'ore') {
        await interaction.deferReply();

        const query = interaction.options.getString('name');

        try {
            const results = await searchAllWikis(query);

            const pages = results.flatMap(result =>
                result.pages.map(page => ({
                    ...page,
                    wiki: result.wiki
                }))
            );

            const embed = new EmbedBuilder()
                .setTitle(`⛏️ Wiki search: ${query}`)
                .setColor(0x00FFCC)
                .setTimestamp();

            if (pages.length) {
                embed.setDescription(
                    pages.slice(0, 10).map(page =>
                        `**${page.title}** (${page.wiki})\n` +
                        `${page.snippet}\n` +
                        `[Open wiki page](${page.url})`
                    ).join('\n\n').slice(0, 4000)
                );
            } else {
                embed.setDescription(
                    'No results found in the configured wikis.'
                );
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(error);

            await interaction.editReply(
                'Wiki search failed.'
            );
        }

        return;
    }

    // MISTER T9 COMMAND
    if (interaction.commandName === 't9') {
        const action = interaction.options.getString('action');

        if (action === 'join') {
            const voiceChannel =
                interaction.member.voice?.channel;

            if (!voiceChannel) {
                return interaction.reply({
                    content: 'Join a voice channel first!',
                    ephemeral: true
                });
            }

            const botPermissions =
                voiceChannel.permissionsFor(client.user);

            if (
                !botPermissions?.has(PermissionFlagsBits.Connect) ||
                !botPermissions?.has(PermissionFlagsBits.Speak)
            ) {
                return interaction.reply({
                    content: 'I need Connect and Speak permissions.',
                    ephemeral: true
                });
            }

            if (
                !interaction.member.voice.channelId
            ) {
                return interaction.reply({
                    content: 'Join a voice channel first.',
                    ephemeral: true
                });
            }

            await interaction.reply({
                content: '🤖 Connecting Mister T9...',
                ephemeral: true
            });

            try {
                await joinT9(
                    voiceChannel,
                    interaction.channel
                );
            } catch (error) {
                console.error(error);

                await interaction.followUp({
                    content: `Connection failed: ${error.message}`,
                    ephemeral: true
                });
            }
        }

        if (action === 'leave') {
            const session =
                voiceSessions.get(interaction.guildId);

            if (!session) {
                return interaction.reply({
                    content: 'Mister T9 is not connected.',
                    ephemeral: true
                });
            }

            voiceSessions.delete(interaction.guildId);

            session.player.stop(true);
            session.connection.destroy();

            await interaction.reply(
                '🤖 Mister T9 disconnected. Voice listening stopped.'
            );
        }
    }
});

// ==========================================
// ORIGINAL RARE DROP TRACKER
// ==========================================

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (
        message.channel.id !== TRACKER_CHANNEL_ID ||
        message.embeds.length === 0
    ) {
        return;
    }

    const mainEmbed = message.embeds[0];

    const fullContent = (
        (mainEmbed.description || '') + ' ' +
        (mainEmbed.author?.name || '')
    ).toLowerCase();

    const isMatched = linkedPlayers.some(name =>
        fullContent.includes(name.toLowerCase())
    );

    if (!isMatched) return;

    const isPrivate = fullContent.includes('private server');

    const targetChannelId = isPrivate
        ? process.env.DISCORD_PRIVATE_CHANNEL_ID
        : process.env.DISCORD_CHANNEL_ID;

    if (!targetChannelId) return;

    try {
        const targetChannel =
            await client.channels.fetch(targetChannelId);

        if (!targetChannel?.isTextBased()) return;

        const clonedEmbed = EmbedBuilder.from(mainEmbed);

        await targetChannel.send({
            content: '🎉 **New Rare Drop Detected!**',
            embeds: [clonedEmbed]
        });

    } catch (error) {
        console.error('Tracker error:', error);
    }
});

// ==========================================
// GLOBAL ERROR HANDLING
// ==========================================

process.on('unhandledRejection', error => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

client.login(process.env.DISCORD_TOKEN);


