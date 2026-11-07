
require("dotenv").config();

const express = require("express");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
  EndBehaviorType,
  entersState
} = require("@discordjs/voice");

const prism = require("prism-media");
const { Readable } = require("stream");

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";
const TRACKER_CHANNEL_ID =
  process.env.TRACKER_CHANNEL_ID || "1403313906906173480";

const PUBLIC_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const PRIVATE_CHANNEL_ID =
  process.env.DISCORD_PRIVATE_CHANNEL_ID;

const PORT = process.env.PORT || 3000;

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is missing!");
}

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is missing!");
}

// Configure FFmpeg if installed.
try {
  const ffmpegPath = require("ffmpeg-static");

  if (ffmpegPath) {
    process.env.PATH =
      path.dirname(ffmpegPath) +
      path.delimiter +
      process.env.PATH;
  }
} catch (error) {
  console.warn("FFmpeg is not installed.");
}

// --------------------------------------------------
// WIKI CONFIGURATION
// --------------------------------------------------

const WIKI_ENDPOINTS = [
  process.env.WIKI_API_URLS,
  process.env.FANDOM_API_URL,
  process.env.OTHER_WIKI_API_URL
]
  .filter(Boolean)
  .flatMap(value => value.split(","))
  .map(value => value.trim())
  .filter(Boolean);

if (!WIKI_ENDPOINTS.length) {
  WIKI_ENDPOINTS.push(
    "https://en.wikipedia.org/w/api.php"
  );
}

// Players monitored by the tracker.
const linkedPlayers = [
  "a678xd",
  "Ahmds_19",
  "windowss134"
];

// --------------------------------------------------
// EXPRESS SERVER
// --------------------------------------------------

const app = express();

app.get("/", (req, res) => {
  res.send("Mining Tech Bot and Mister T9 are online!");
});

app.get("/health", (req, res) => {
  res.json({ status: "online" });
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

// --------------------------------------------------
// DISCORD CLIENT
// --------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const voiceSessions = new Map();
const processingUsers = new Set();
const armedUsers = new Map();



// --------------------------------------------------
// GEMINI API
// --------------------------------------------------

async function geminiGenerate(
  contents,
  systemInstruction,
  options = {}
) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const attempt = options.retryAttempt ?? 0;

  let response;

  try {
    console.log(
      `Gemini: sending request (attempt ${attempt + 1}/4)...`
    );

    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.5,
          maxOutputTokens: options.maxOutputTokens ?? 250
        }
      }),
      signal: AbortSignal.timeout(90000)
    });

  } catch (error) {
    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError"
    ) {
      throw new Error(
        "Gemini request timed out after 90 seconds. Check API availability."
      );
    }

    throw new Error(
      `Gemini connection failed: ${error.message}`
    );
  }

  const responseText = await response.text();

  console.log("Gemini HTTP STATUS:", response.status);
  console.log(
    "Gemini RESPONSE:",
    responseText.slice(0, 1500)
  );

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Gemini returned an invalid response. HTTP ${response.status}`
    );
  }

  if (!response.ok) {
    const message =
      data.error?.message ||
      `Gemini API error: ${response.status}`;

    const temporaryError =
      response.status === 429 ||
      response.status === 500 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504;

    if (temporaryError && attempt < 3) {
      const delay = 2000 * (attempt + 1);

      console.log(
        `Gemini temporarily unavailable. Retry ${attempt + 1}/3 in ${delay / 1000} seconds.`
      );

      await new Promise(resolve =>
        setTimeout(resolve, delay)
      );

      return geminiGenerate(
        contents,
        systemInstruction,
        {
          ...options,
          retryAttempt: attempt + 1
        }
      );
    }

    throw new Error(message);
  }

  const result = (
    data.candidates?.[0]?.content?.parts || []
  )
    .map(part => part.text || "")
    .join("")
    .trim();

  if (!result) {
    throw new Error(
      "Gemini returned an empty answer."
    );
  }

  console.log("Gemini: response received.");

  return result;
}


// --------------------------------------------------
// AUDIO CONVERSION
// --------------------------------------------------

function createWav(pcm) {
  const channels = 2;
  const sampleRate = 48000;
  const bitsPerSample = 16;
  const blockAlign = channels * bitsPerSample / 8;

  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(
    sampleRate * blockAlign,
    28
  );
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

// --------------------------------------------------
// GEMINI SPEECH RECOGNITION
// --------------------------------------------------

async function transcribeAudio(wavBuffer) {
  return geminiGenerate(
    [{
      role: "user",
      parts: [
        {
          text:
            "Transcribe exactly what the speaker says. " +
            "Return only the spoken words. " +
            "Do not answer the speaker. " +
            "If there is no understandable speech, return [inaudible]."
        },
        {
          inlineData: {
            mimeType: "audio/wav",
            data: wavBuffer.toString("base64")
          }
        }
      ]
    }],
    "You are a speech transcription system.",
    {
      temperature: 0.1,
      maxOutputTokens: 150
    }
  );
}

// --------------------------------------------------
// WIKI SEARCH
// --------------------------------------------------

function cleanHtml(text = "") {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function searchOneWiki(endpoint, query) {
  try {
    const url = new URL(endpoint);

    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", query);
    url.searchParams.set("srlimit", "3");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("utf8", "1");

    const response = await fetch(url, {
      headers: {
        "User-Agent": "MisterT9DiscordBot/2.0"
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error(`Wiki HTTP ${response.status}`);
    }

    const data = await response.json();

    const pages = data.query?.search || [];

    return pages.map(page => ({
      wiki: new URL(endpoint).hostname,
      title: page.title,
      snippet: cleanHtml(page.snippet),
      url:
        `${new URL(endpoint).origin}/wiki/` +
        encodeURIComponent(
          page.title.replace(/ /g, "_")
        )
    }));

  } catch (error) {
    console.error(
      `Wiki error (${endpoint}):`,
      error.message
    );

    return [];
  }
}

async function searchAllWikis(query) {
  const results = await Promise.all(
    WIKI_ENDPOINTS.map(endpoint =>
      searchOneWiki(endpoint, query)
    )
  );

  return results.flat().slice(0, 12);
}

// --------------------------------------------------
// MISTER T9 AI
// --------------------------------------------------

async function askMisterT9(question, wikiResults = []) {
  const wikiContext = wikiResults.length
    ? wikiResults.map((item, index) =>
        `${index + 1}. Wiki: ${item.wiki}\n` +
        `Title: ${item.title}\n` +
        `Information: ${item.snippet}\n` +
        `Link: ${item.url}`
      ).join("\n\n")
    : "No matching wiki results were found.";

  const prompt = `
The user asked: ${question}

Configured wiki search results:
${wikiContext}

Answer the user's question.

Rules:
- Use wiki information when relevant.
- Do not invent facts from the wiki.
- If the information is missing, say so.
- You can answer general questions using your knowledge.
- Keep your answer concise and natural.
- Do not use Markdown formatting.
`;

  return geminiGenerate(
    [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    `You are Mister T9, a friendly futuristic robotic
assistant in a Discord voice channel.

Personality:
- Robotic and intelligent.
- Calm and friendly.
- Helpful and confident.
- Keep answers short enough to speak aloud.
- Your name is Mister T9.`,
    {
      temperature: 0.6,
      maxOutputTokens: 250
    }
  );
}

// --------------------------------------------------
// GOOGLE TEXT TO SPEECH
// --------------------------------------------------

function waitForPlayerIdle(player) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off("error", onError);
    };

    const onIdle = () => {
      cleanup();
      resolve();
    };

    const onError = error => {
      cleanup();
      reject(error);
    };

    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once("error", onError);
  });
}

async function speak(guildId, text) {
  const session = voiceSessions.get(guildId);

  if (!session || !text) return;

  const safeText = String(text).slice(0, 700);

  console.log("TTS: generating Microsoft Edge voice response.");

  try {
    // Load Microsoft Edge TTS.
    const { EdgeTTS } = await import("@andresaya/edge-tts");
    const tts = new EdgeTTS();

    // Generate speech using a natural English voice.
    const result = await tts.generate(
      safeText,
      "en-US-GuyNeural",
      {
        outputFormat: "webm-24khz-16bit-mono-opus",
        rate: "-5%",
        volume: "90%"
      }
    );

    const audioBuffer = Buffer.from(result.audio);

    if (!audioBuffer.length) {
      throw new Error("Microsoft Edge TTS returned empty audio.");
    }

    console.log("TTS: audio generated:", audioBuffer.length, "bytes.");

    // Make sure the voice session still exists.
    if (voiceSessions.get(guildId) !== session) {
      return;
    }

    const resource = createAudioResource(
      Readable.from(audioBuffer),
      {
        inputType: StreamType.WebmOpus
      }
    );

    session.player.play(resource);

    console.log("TTS: playing audio in Discord.");

    await waitForPlayerIdle(session.player);

    console.log("TTS: finished speaking.");

  } catch (error) {
    console.error("MICROSOFT EDGE TTS ERROR:", error);
    throw error;
  }
}

// --------------------------------------------------
// SEND TEXT AND VOICE ANSWER
// --------------------------------------------------

async function answerQuestion(guildId, question) {
  const session = voiceSessions.get(guildId);

  if (!session) return;

  console.log("MISTER T9 QUESTION:", question);

  try {
    const textChannel = await client.channels.fetch(
      session.textChannelId
    );

    // Search the configured wikis.
    console.log("Searching configured wikis...");

    const wikiResults = await searchAllWikis(question);

    console.log(
      `Wiki search returned ${wikiResults.length} results.`
    );

    // Generate the AI answer.
    console.log("Asking Gemini...");

    const answer = await askMisterT9(
      question,
      wikiResults
    );

    console.log("GEMINI ANSWER:", answer);

    // Send answer to Discord text channel first.
    if (textChannel && textChannel.isTextBased()) {
      await textChannel.send({
        content: `🤖 **Mister T9:** ${answer}`.slice(0, 1900)
      }).catch(error => {
        console.error("Text reply error:", error.message);
      });
    }

    // Then speak the answer.
    console.log("Sending spoken answer...");

    await speak(guildId, answer);

    console.log("MISTER T9 FINISHED ANSWERING.");

  } catch (error) {
    console.error("ANSWER ERROR:", error);

    const currentSession = voiceSessions.get(guildId);

    if (currentSession) {
      const textChannel = await client.channels.fetch(
        currentSession.textChannelId
      ).catch(() => null);

      if (textChannel && textChannel.isTextBased()) {
        await textChannel.send(
          `⚠️ Mister T9 error: ${error.message}`
        ).catch(() => {});
      }

      await speak(
        guildId,
        "My systems encountered an error. Check the Discord text channel."
      ).catch(console.error);
    }
  }
}

// --------------------------------------------------
// WAKE PHRASE
// --------------------------------------------------

function normalizeSpeech(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleTranscript(
  guildId,
  userId,
  transcript
) {
  if (!transcript) return;

  if (transcript.toLowerCase().includes("[inaudible]")) {
    console.log("No understandable speech detected.");
    return;
  }

  const key = `${guildId}:${userId}`;

  const normalized = normalizeSpeech(transcript);

  console.log("NORMALIZED SPEECH:", normalized);

  const wakePattern =
    /\bhey\s+(?:mister|mr)\s+t\s*(?:9|nine)\b/;

  const wakeMatch = normalized.match(wakePattern);

  // Wake phrase detected.
  if (wakeMatch) {
    console.log("WAKE PHRASE DETECTED!");

    armedUsers.set(
      key,
      Date.now() + 25000
    );

    const question = normalized
      .replace(wakePattern, "")
      .trim();

    try {
      await speak(guildId, "What?");
    } catch (error) {
      console.error("Wake response TTS error:", error);
    }

    // If the question was spoken with the wake phrase.
    if (question.length > 2) {
      console.log("Question included with wake phrase.");

      armedUsers.delete(key);

      await answerQuestion(guildId, question);
    } else {
      console.log(
        "Waiting for the user to ask a question..."
      );
    }

    return;
  }

  // User has already said the wake phrase.
  const armedUntil = armedUsers.get(key);

  if (armedUntil && armedUntil > Date.now()) {
    console.log("WAKE SESSION ACTIVE. ANSWERING QUESTION.");

    armedUsers.delete(key);

    await answerQuestion(guildId, transcript);

    return;
  }

  console.log("Wake phrase not detected. Ignoring speech.");
}

// --------------------------------------------------
// DISCORD VOICE LISTENING
// --------------------------------------------------

function listenToUser(guildId, userId) {
  const session = voiceSessions.get(guildId);

  if (!session) return;

  if (!session.allowedUsers.has(userId)) {
    console.log("User not authorized:", userId);
    return;
  }

  const key = `${guildId}:${userId}`;

  if (processingUsers.has(key)) return;

  if (userId === client.user.id) return;

  console.log("STARTING AUDIO CAPTURE:", userId);

  processingUsers.add(key);

  let opusStream;
  let decoder;
  let finished = false;
  let timeout;

  const chunks = [];
  let totalBytes = 0;

  const finish = async () => {
    if (finished) return;

    finished = true;

    clearTimeout(timeout);

    try {
      const currentSession = voiceSessions.get(guildId);

      if (currentSession !== session) return;

      const pcm = Buffer.concat(chunks);

      console.log(
        `Captured ${pcm.length} bytes of PCM audio.`
      );

      if (pcm.length < 12000) {
        console.log("Audio recording too short.");
        return;
      }

      if (pcm.length > 5 * 1024 * 1024) {
        console.log("Audio recording too large.");
        return;
      }

      const wav = createWav(pcm);

      console.log("Sending audio to Gemini for transcription...");

      const transcript = await transcribeAudio(wav);

      console.log(
        `TRANSCRIPT FROM ${userId}: ${transcript}`
      );

      await handleTranscript(
        guildId,
        userId,
        transcript
      );

    } catch (error) {
      console.error("VOICE PROCESSING ERROR:", error);

    } finally {
      processingUsers.delete(key);

      if (opusStream && !opusStream.destroyed) {
        opusStream.destroy();
      }

      if (decoder && !decoder.destroyed) {
        decoder.destroy();
      }
    }
  };

  try {
    opusStream = session.connection.receiver.subscribe(
      userId,
      {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000
        }
      }
    );

    decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960
    });

    decoder.on("data", chunk => {
      totalBytes += chunk.length;

      if (totalBytes > 5 * 1024 * 1024) {
        console.log("Audio size limit reached.");
        finish();
        return;
      }

      chunks.push(chunk);
    });

    decoder.once("end", finish);

    decoder.once("error", error => {
      console.error("Decoder error:", error.message);
      finish();
    });

    opusStream.once("error", error => {
      console.error("Opus stream error:", error.message);
      finish();
    });

    timeout = setTimeout(() => {
      console.log("Audio recording time limit reached.");

      if (opusStream && !opusStream.destroyed) {
        opusStream.destroy();
      }

      if (decoder && !decoder.destroyed) {
        decoder.end();
      }
    }, 15000);

    opusStream.pipe(decoder);

  } catch (error) {
    console.error("Could not listen:", error);

    processingUsers.delete(key);
  }
}

// --------------------------------------------------
// JOIN MISTER T9
// --------------------------------------------------

async function joinT9(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;
  const channel = member.voice.channel;

  if (!channel) {
    throw new Error(
      "Join a voice channel before calling Mister T9."
    );
  }

  if (voiceSessions.has(guild.id)) {
    throw new Error(
      "Mister T9 is already connected."
    );
  }

  const permissions = channel.permissionsFor(
    guild.members.me
  );

  if (
    !permissions ||
    !permissions.has(PermissionFlagsBits.Connect) ||
    !permissions.has(PermissionFlagsBits.Speak) ||
    !permissions.has(PermissionFlagsBits.ViewChannel)
  ) {
    throw new Error(
      "Mister T9 needs View Channel, Connect and Speak permissions."
    );
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });

  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause
    }
  });

  connection.subscribe(player);

  const allowedUsers = new Set(
    channel.members
      .filter(member => !member.user.bot)
      .map(member => member.id)
  );

  const session = {
    connection,
    player,
    channelId: channel.id,
    textChannelId: interaction.channelId,
    allowedUsers
  };

  voiceSessions.set(guild.id, session);

  connection.receiver.speaking.on(
    "start",
    userId => {
      console.log("VOICE DETECTED FROM:", userId);

      listenToUser(guild.id, userId);
    }
  );

  connection.on(
    VoiceConnectionStatus.Disconnected,
    () => {
      console.log("Voice connection disconnected.");

      if (voiceSessions.get(guild.id) === session) {
        voiceSessions.delete(guild.id);

        player.stop(true);

        connection.destroy();
      }
    }
  );

  await entersState(
    connection,
    VoiceConnectionStatus.Ready,
    20000
  );

  await interaction.channel.send(
    "🤖 Mister T9 is online. Voice audio is processed by Google Gemini. Everyone must agree before speaking."
  );

  await speak(
    guild.id,
    "Mister T9 online. Audio systems active. Say Hey Mister T9 when you need me."
  );
}

// --------------------------------------------------
// LEAVE MISTER T9
// --------------------------------------------------

function leaveT9(guildId) {
  const session = voiceSessions.get(guildId);

  if (!session) return false;

  voiceSessions.delete(guildId);

  session.player.stop(true);

  session.connection.destroy();

  for (const key of armedUsers.keys()) {
    if (key.startsWith(`${guildId}:`)) {
      armedUsers.delete(key);
    }
  }

  return true;
}

// --------------------------------------------------
// SLASH COMMANDS
// --------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("ore")
    .setDescription("Search for an ore in configured wikis.")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Name of the ore")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("t9")
    .setDescription("Control Mister T9.")
    .addSubcommand(subcommand =>
      subcommand
        .setName("join")
        .setDescription("Connect Mister T9.")
        .addBooleanOption(option =>
          option
            .setName("consent")
            .setDescription(
              "Confirm everyone agrees to voice processing."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("leave")
        .setDescription("Disconnect Mister T9.")
    )
];


 // --------------------------------------------------
 // REGISTER COMMANDS IN BOTH SERVERS
 // --------------------------------------------------

async function registerCommands() {
  const GUILD_IDS = [
    "1484736376053436426",
    "1429096347037995061"
  ];

  for (const guildId of GUILD_IDS) {
    try {
      const guild = await client.guilds.fetch(guildId);

      await guild.commands.set(commands);

      console.log(
        `SUCCESS: Commands registered in ${guild.name}`
      );

    } catch (error) {
      console.error(
        `COMMAND REGISTRATION ERROR for ${guildId}:`,
        error.message
      );
    }
  }

  console.log("COMMAND REGISTRATION FINISHED.");
}


// --------------------------------------------------
// COMMAND HANDLER
// --------------------------------------------------

client.on(
  Events.InteractionCreate,
  async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === "ore") {
        await interaction.deferReply();

        const query =
          interaction.options.getString("name");

        const results = await searchAllWikis(query);

        if (!results.length) {
          await interaction.editReply(
            `No wiki results found for ${query}.`
          );

          return;
        }

        const description = results
          .slice(0, 8)
          .map((item, index) =>
            `**${index + 1}. [${item.title}](${item.url})**\n` +
            `${item.snippet || "No description available."}\n` +
            `Wiki: ${item.wiki}`
          )
          .join("\n\n")
          .slice(0, 4000);

        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`Ore search: ${query}`)
          .setDescription(description)
          .setFooter({
            text: "Mister T9 Wiki Search"
          });

        await interaction.editReply({
          embeds: [embed]
        });

        return;
      }

      if (interaction.commandName === "t9") {
        const subcommand =
          interaction.options.getSubcommand();

        if (subcommand === "join") {
          const consent =
            interaction.options.getBoolean("consent");

          if (!consent) {
            await interaction.reply({
              content:
                "Everyone must agree before Mister T9 can process voice audio.",
              ephemeral: true
            });

            return;
          }

          await interaction.deferReply({
            ephemeral: true
          });

          await joinT9(interaction);

          await interaction.editReply(
            "Mister T9 is online!"
          );

          return;
        }

        if (subcommand === "leave") {
          const session =
            voiceSessions.get(interaction.guildId);

          if (!session) {
            await interaction.reply({
              content: "Mister T9 is not connected.",
              ephemeral: true
            });

            return;
          }

          const memberChannel =
            interaction.member.voice.channelId;

          if (
            memberChannel !== session.channelId &&
            !interaction.member.permissions.has(
              PermissionFlagsBits.ManageGuild
            )
          ) {
            await interaction.reply({
              content:
                "You must be in Mister T9's voice channel or have Manage Server permission.",
              ephemeral: true
            });

            return;
          }

          leaveT9(interaction.guildId);

          await interaction.reply({
            content: "Mister T9 disconnected.",
            ephemeral: true
          });

          return;
        }
      }

    } catch (error) {
      console.error("COMMAND ERROR:", error);

      const message =
        error.message || "Something went wrong.";

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else {
        await interaction.reply({
          content: message,
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
);

// --------------------------------------------------
// VOICE CHANNEL CONSENT
// --------------------------------------------------

client.on(
  Events.VoiceStateUpdate,
  async (oldState, newState) => {
    if (!client.user) return;

    if (newState.id === client.user.id) return;

    const session = voiceSessions.get(
      newState.guild.id
    );

    if (!session) return;

    const joinedT9Channel =
      newState.channelId === session.channelId &&
      oldState.channelId !== session.channelId;

    if (joinedT9Channel) {
      const textChannel = await client.channels
        .fetch(session.textChannelId)
        .catch(() => null);

      leaveT9(newState.guild.id);

      if (textChannel) {
        await textChannel.send(
          "Mister T9 disconnected because someone new joined. Please confirm everyone's agreement before reconnecting."
        ).catch(() => {});
      }
    }
  }
);

// --------------------------------------------------
// MINING TECH TRACKER
// --------------------------------------------------

client.on(
  Events.MessageCreate,
  async message => {
    try {
      if (message.channelId !== TRACKER_CHANNEL_ID) {
        return;
      }

      if (!message.embeds.length) return;

      for (const embed of message.embeds) {
        const embedText = [
          embed.title || "",
          embed.description || "",
          embed.author?.name || "",
          ...(embed.fields || []).map(field =>
            `${field.name} ${field.value}`
          )
        ].join(" ").toLowerCase();

        const matchedPlayer = linkedPlayers.some(
          player =>
            embedText.includes(player.toLowerCase())
        );

        if (!matchedPlayer) continue;

        const isPrivateServer =
          embedText.includes("private server");

        const targetChannelId = isPrivateServer
          ? PRIVATE_CHANNEL_ID
          : PUBLIC_CHANNEL_ID;

        if (!targetChannelId) {
          console.warn(
            "Tracker destination channel is missing."
          );

          continue;
        }

        const targetChannel =
          await client.channels.fetch(targetChannelId);

        if (
          !targetChannel ||
          !targetChannel.isTextBased()
        ) {
          continue;
        }

        await targetChannel.send({
          embeds: [embed]
        });

        console.log("Tracker embed forwarded.");
      }

    } catch (error) {
      console.error("TRACKER ERROR:", error);
    }
  }
);

// --------------------------------------------------
// BOT READY
// --------------------------------------------------

client.once(
  Events.ClientReady,
  async readyClient => {
    console.log(
      `${readyClient.user.tag} is online!`
    );

    console.log("Mister T9 Gemini system ready.");

    await registerCommands();
  }
);

// --------------------------------------------------
// ERROR HANDLING
// --------------------------------------------------

process.on("unhandledRejection", error => {
  console.error("UNHANDLED REJECTION:", error);
});

process.on("uncaughtException", error => {
  console.error("UNCAUGHT EXCEPTION:", error);

  process.exit(1);
});

// --------------------------------------------------
// SHUTDOWN
// --------------------------------------------------

async function shutdown() {
  console.log("Shutting down Mister T9...");

  for (const guildId of voiceSessions.keys()) {
    leaveT9(guildId);
  }

  client.destroy();

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

client.login(DISCORD_TOKEN);
