const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Mining Tech Sync Bot Active!'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const TRACKER_CHANNEL_ID = '1403313906906173480'; 

// This map links { RobloxUsername: DiscordUserID }
const linkedPlayers = new Map();

client.on('messageCreate', async (message) => {
    // 1. MONITOR THE INCOMING LOGS IN THAT CHANNEL
    if (message.channel.id === TRACKER_CHANNEL_ID) {
        if (message.embeds.length > 0) {
            const myChannel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
            if (!myChannel) return;

            const originalEmbed = message.embeds[0];
            const contentText = (originalEmbed.description || "") + (originalEmbed.author?.name || "");

            let matchedUser = null;
            for (let robloxName of linkedPlayers.keys()) {
                if (contentText.toLowerCase().includes(robloxName.toLowerCase())) {
                    matchedUser = robloxName;
                    break;
                }
            }

            // ONLY forward if the player has connected their Roblox name!
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

    // 2. TEXT COMMANDS FOR CONNECTING PEOPLE (Ignore other bots)
    if (message.author.bot) return;

    // Type "!link RobloxName" to connect
    if (message.content.startsWith('!link ')) {
        const robloxName = message.content.slice(6).trim();
        
        if (!robloxName) {
            return message.reply("❌ Please provide a valid username! Example: `!link Builderman`");
        }

        linkedPlayers.set(robloxName, message.author.id);
        message.reply(`✅ Connected! I am now tracking rare drops for **${robloxName}**.`);
    }

    // Type "!linked" to check who is connected
    if (message.content === '!linked') {
        if (linkedPlayers.size === 0) return message.reply("No accounts are currently connected!");
        
        let list = "📋 **Currently Monitored Players:**\n";
        linkedPlayers.forEach((discordId, robloxName) => {
            list += `• **${robloxName}** -> <@${discordId}>\n`;
        });
        message.reply(list);
    }
});

client.login(process.env.DISCORD_TOKEN);
