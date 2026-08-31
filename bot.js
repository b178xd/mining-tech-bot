const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();

// We keep express alive so Render doesn't shut down your app
app.get('/', (req, res) => res.send('Mining Tech Tracker is active!'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// The exact tracker channel ID you want to look at
const TRACKER_CHANNEL_ID = '1403313906906173480'; 

client.on('messageCreate', async (message) => {
    // 1. Check if the message is coming from the target channel
    if (message.channel.id === TRACKER_CHANNEL_ID) {
        
        // Find your own server's target channel where the bot drops the clones
        const myChannel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        if (!myChannel) return;

        // 2. If the original message has an embed structure (like high-tier ore cards)
        if (message.embeds.length > 0) {
            // Clone the embeds and forward them to your channel
            const clonedEmbeds = message.embeds.map(oldEmbed => EmbedBuilder.from(oldEmbed));
            
            myChannel.send({ 
                content: message.content || null, 
                embeds: clonedEmbeds 
            }).catch(console.error);
        } 
        // 3. If it's just a regular text message alert
        else if (message.content) {
            myChannel.send({ content: message.content }).catch(console.error);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot server listening on port ${PORT}`));
