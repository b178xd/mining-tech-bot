const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Mining Tech Sync Bot Active!'));
app.listen(process.env.PORT || 3000);

// Podstawowe intencje akceptowane przez Discord bez blokad
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages
    ]
});

const TRACKER_CHANNEL_ID = '1403313906906173480'; 
const linkedPlayers = ["a678xd", "Ahmds_19", "windowss1345"]; 

// Baza danych Tierów popularnych rud z Mining Tech Wiki dla szybkiego podglądu
const wikiOreDatabase = {
    "tyrolite": { rarity: "1 in 500,000", tier: "Tier 6", desc: "One of the best ores in the game, due to its spiritual powers. Iconic symbol within the game." },
    "bismuthinite": { rarity: "1 in 50,000,000", tier: "Tier 8", desc: "Extremely rare ore added in the Tier 8 update. Hard-coded names." },
    "wakefieldite": { rarity: "1 in 500,000", tier: "Tier 6", desc: "Triggers regional server notifications when discovered." },
    "vorontsovite": { rarity: "1 in 500,000", tier: "Tier 6", desc: "Rare high-tier ore compound found deep within the Metal Rock layer." },
    "chalcopyrite": { rarity: "1 in 500,000", tier: "Tier 6", desc: "High-value composite ore matrix." },
    "carlosruizite": { rarity: "1 in 5,000,000", tier: "Tier 7", desc: "Ultra-rare Tier 7 drop variant." },
    "hutchinsonite": { rarity: "1 in 5,000,000", tier: "Tier 7", desc: "Requires high pick points to mine effectively." }
};

// --- 1. REJESTRACJA I OBSŁUGA SLASH COMMAND (/ore) ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ore') {
        const query = interaction.options.getString('name').trim();
        const lowerQuery = query.toLowerCase();
        
        // Formatowanie tekstu dla adresu URL Fandomu (np. "tyrolite" -> "Tyrolite")
        const formattedName = query.charAt(0).toUpperCase() + query.slice(1);
        const wikiUrl = `https://mining-tech.fandom.com/wiki/Mining_Tech_Wiki}`;
        
        const matchedOre = wikiOreDatabase[lowerQuery];

        const embed = new EmbedBuilder()
            .setTitle(`⛏️ Mining Tech Wiki Lookup: ${formattedName}`)
            .setURL(wikiUrl)
            .setColor(0x00FFCC)
            .setTimestamp();

        if (matchedOre) {
            embed.setDescription(`Here are the quick statistics fetched from the local wiki database index for **${formattedName}**:`)
                 .addFields(
                     { name: 'Rarity', value: matchedOre.rarity, inline: true },
                     { name: 'Tier Class', value: matchedOre.tier, inline: true },
                     { name: 'Direct Description', value: matchedOre.desc, inline: false },
                     { name: 'Official Fandom Page', value: `🌐 [Click here to view full wiki page](${wikiUrl})`, inline: false }
                 );
        } else {
            embed.setDescription(`This ore is not hard-coded in the local quick-index, but you can jump directly to its live page on the community wiki document right here:`)
                 .addFields({ name: 'Live Link', value: `🌐 [Open ${formattedName} page on Mining Tech Wiki](${wikiUrl})`, inline: false })
                 .setFooter({ text: 'Ensure the name matches the exact game spelling!' });
        }

        await interaction.reply({ embeds: [embed] });
    }
});

// --- 2. LIVE MONITORING LOGÓW Z GRY ---
client.on('messageCreate', async (message) => {
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
});

client.login(process.env.DISCORD_TOKEN);

