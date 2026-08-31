const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();

// Keeps the web server alive so hosting services don't shut the application down
app.get('/', (req, res) => res.send('Mining Tech Sync Bot Active!'));
app.listen(process.env.PORT || 3000);

// Initialize the Discord Client with mandatory intents and partials for webhook reading
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.User]
});

// The exact Discord Channel ID the bot monitors for incoming ore drops
const TRACKER_CHANNEL_ID = '1403313906906173480'; 

// Temporary local database map linking { RobloxUsername: DiscordUserID }
const linkedPlayers = new Map();

client.on('messageCreate', async (message) => {
    
    // --- 1. THE EMBED FILTERING & MIRRORING LOGIC ---
    if (message.channel.id === TRACKER_CHANNEL_ID) {
        if (message.embeds.length > 0) {
            // Target channel where the bot drops the mirrored alerts
            const myChannel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
            if (!myChannel) return;

            const originalEmbed = message.embeds[0];
            const contentText = (originalEmbed.description || "") + (originalEmbed.author?.name || "");

            // Scan the whitelisted names map to see if a connected player triggered the drop
            let matchedUser = null;
            for (let robloxName of linkedPlayers.keys()) {
                if (contentText.toLowerCase().includes(robloxName.toLowerCase())) {
                    matchedUser = robloxName;
                    break;
                }
            }

            // ONLY forward the drop if the username exists in the connected player database
            if (matchedUser) {
                const discordUserId = linkedPlayers.get(matchedUser);
                const clonedEmbed = EmbedBuilder.from(originalEmbed);
                
                myChannel.send({ 
                    content: `🎉 **Rare Find!** <@${discordUserId}> just hit big!`, 
                    embeds: [clonedEmbed] 
                }).catch(console.error);
            }
        }
    }

    // Ignore chat text if it comes from another bot application
    if (message.author.bot) return;

    // --- 2. USER CHAT COMMANDS ---
    
    // Command to connect accounts: Type "!link RobloxName"
    if (message.content.startsWith('!link ')) {
        const robloxName = message.content.slice(6).trim();
        
        if (!robloxName) {
            return message.reply("❌ Please provide a valid username! Example: `!link Builderman`");
        }

        linkedPlayers.set(robloxName, message.author.id);
        message.reply(`✅ Connected! I am now tracking rare drops for **${robloxName}**.`);
    }

    // Command to check active tracking list: Type "!linked"
    if (message.content === '!linked') {
        if (linkedPlayers.size === 0) return message.reply("No accounts are currently connected!");
        
        let list = "📋 **Currently Monitored Players:**\n";
        linkedPlayers.forEach((discordId, robloxName) => {
            list += `• **${robloxName}** -> <@${discordId}>\n`;
        });
        message.reply(list);
    }
});

// Authenticate using the secure Environment Variable token
client.login(process.env.DISCORD_TOKEN);
