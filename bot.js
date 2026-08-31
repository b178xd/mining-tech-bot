const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();

app.use(express.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// This endpoint listens for incoming chat data from your computer
app.post('/check-chat', (req, res) => {
    const { chatMessage } = req.body;
    
    // Filters for Mining Tech game alerts (looking for keywords like "found a" or "tier")
    if (chatMessage.toLowerCase().includes('found a') || chatMessage.toLowerCase().includes('tier')) {
        
        const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID); 
        
        if (channel) {
            // Cleans up the log line by removing the technical Roblox markers
            const cleanText = chatMessage.split('] ').pop() || chatMessage;

            const embed = new EmbedBuilder()
                .setTitle('💎 RARE ORE MINED! 💎')
                .setDescription(`🚀 **Private Server Broadcast:**\n\`\`\`text\n${cleanText.trim()}\n\`\`\``)
                .setColor(0x00FFCC)
                .setTimestamp();

            channel.send({ embeds: [embed] });
            return res.status(200).send("Notification sent to Discord.");
        }
    }
    res.status(200).send("Message ignored (normal chat).");
});

client.login(process.env.DISCORD_TOKEN);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot server listening on port ${PORT}`));
