const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Mining Tech Sync Bot Active!'));
app.listen(process.env.PORT || 3000);

// We stripped out all special intents! Discord will NEVER block this basic login.
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages
    ]
});

const TRACKER_CHANNEL_ID = '1403313906906173480'; 

// Basic list to track names
const linkedPlayers = ["b178xd", "Ahmds_19", "windowss1345"]; // Add your Roblox name here inside quotes!

client.on('messageCreate', async (message) => {
    // Monitor the original channel logs
    if (message.channel.id === TRACKER_CHANNEL_ID && message.embeds.length > 0) {
        const myChannel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        if (!myChannel) return;

        const originalEmbed = message.embeds[0];
        const contentText = (originalEmbed.description || "") + (originalEmbed.author?.name || "");

        // Check if any whitelisted name is found in the drop text
        let isMatched = false;
        for (let robloxName of linkedPlayers) {
            if (contentText.toLowerCase().includes(robloxName.toLowerCase())) {
                isMatched = true;
                break;
            }
        }

        // Forward it if it's a match!
        if (isMatched) {
            const clonedEmbed = EmbedBuilder.from(originalEmbed);
            myChannel.send({ 
                content: `🎉 **New Rare Drop Detected!**`, 
                embeds: [clonedEmbed] 
            }).catch(console.error);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);


