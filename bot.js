const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Mining Tech Sync Bot Active!'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // Keeps this intent active for commands
    ]
});

const TRACKER_CHANNEL_ID = '1403313906906173480'; 

// Put your exact Roblox name here inside the quotes!
const linkedPlayers = ["b178xd"]; 

client.on('messageCreate', async (message) => {
    // --- 1. MONITOR THE ORIGINAL LOGS ---
    if (message.channel.id === TRACKER_CHANNEL_ID && message.embeds.length > 0) {
        const myChannel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        if (!myChannel) return;

        const originalEmbed = message.embeds[0];
        const contentText = (originalEmbed.description || "") + (originalEmbed.author?.name || "");

        let isMatched = false;
        for (let robloxName of linkedPlayers) {
            if (contentText.toLowerCase().includes(robloxName.toLowerCase())) {
                isMatched = true;
                break;
            }
        }

        if (isMatched) {
            const clonedEmbed = EmbedBuilder.from(originalEmbed);
            myChannel.send({ 
                content: `🎉 **New Rare Drop Detected!**`, 
                embeds: [clonedEmbed] 
            }).catch(console.error);
        }
    }

    // --- 2. THE MANUAL TESTING TRIGGER ---
    if (message.author.bot) return;

    if (message.content === '!test') {
        const myChannel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        if (!myChannel) return message.reply("❌ Error: Bot cannot find your server's target channel ID!");

        // Creating a fake drop card mock matching your screenshot
        const testEmbed = new EmbedBuilder()
            .setAuthor({ name: 'High Tier Ore Bot' })
            .setDescription(`**${linkedPlayers[0]} mined a T6**`)
            .addFields(
                { name: 'Name', value: '💎 Infinity Ore (Test)', inline: true },
                { name: 'Rarity', value: '1 of 5,000,000', inline: true },
                { name: 'Layer', value: 'Mining Infinity', inline: true },
                { name: 'Server', value: 'Private Server Test', inline: false }
            )
            .setColor(0x36393F)
            .setTimestamp();

        myChannel.send({ 
            content: `🧪 **[BOT TEST RUN]:** Simulation triggered successfully!`, 
            embeds: [testEmbed] 
        });

        message.reply("✅ Test command executed! Check your notification log channel.");
    }
});

client.login(process.env.DISCORD_TOKEN);
