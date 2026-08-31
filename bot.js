const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();

app.use(express.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

app.post('/ore-mined', (req, res) => {
    const { playerName, oreName, tier } = req.body;
    
    // This reads the Discord Channel ID you will set later in the Render dashboard
    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID); 
    
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle('💎 Rare Ore Found! 💎')
            .setDescription(`**${playerName}** just mined a **${oreName}** (Tier ${tier})!`)
            .setColor(0x00FFCC)
            .setTimestamp();

        channel.send({ embeds: [embed] });
        return res.status(200).send("Notification sent.");
    }
    res.status(500).send("Channel not found.");
});

client.login(process.env.DISCORD_TOKEN);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot server listening on port ${PORT}`));
