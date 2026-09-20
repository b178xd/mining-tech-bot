const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ApplicationCommandOptionType } = require('discord.js');
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Mining Tech Sync Bot Active!'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages
    ]
});

const TRACKER_CHANNEL_ID = '1403313906906173480'; 
const linkedPlayers = ["a678xd", "Ahmds_19", "windowss1345"]; 

// BŁYSKAWICZNA REJESTRACJA NA TWOIM SERWERZE
client.once('ready', async () => {
    try {
        const commands = [{
            name: 'ore',
            description: 'Check information about an ore from the Mining Tech Wiki',
            options: [{
                name: 'name',
                type: ApplicationCommandOptionType.String,
                description: 'The name of the ore to look up',
                required: true
            }]
        }];

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        // Pobieramy ID Twojego serwera i rejestrujemy komendę lokalnie w 1 sekundę
        const guilds = await client.guilds.fetch();
        for (const [guildId] of guilds) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        }
        console.log("✅ Błyskawiczna rejestracja /ore zakończona sukcesem!");
    } catch (error) {
        console.error("Błąd automatycznej rejestracji:", error);
    }
});

// --- OBSŁUGA KOMENDY SLASH (/ore) ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ore') {
        const query = interaction.options.getString('name').trim();
        const formattedName = query.charAt(0).toUpperCase() + query.slice(1).toLowerCase();
        const wikiUrl = `https://fandom.com{formattedName}`;

        const infoEmbed = new EmbedBuilder()
            .setTitle(`⛏️ Mining Tech Wiki Lookup: ${formattedName}`)
            .setURL(wikiUrl)
            .setDescription(`Kliknij w link powyżej, aby zobaczyć tę rudę na oficjalnej Wiki gry!`)
            .addFields(
                { name: 'Nazwa zasobu', value: formattedName, inline: true },
                { name: 'Strona Wiki Fandom', value: `🌐 [Otwórz stronę ${formattedName}](${wikiUrl})`, inline: false }
            )
            .setColor(0x00FFCC)
            .setTimestamp();

        await interaction.reply({ embeds: [infoEmbed] });
    }
});

// --- MONITORING LOGÓW Z SEPARACJĄ KANAŁÓW ---
client.on('messageCreate', async (message) => {
    if (message.channel.id === TRACKER_CHANNEL_ID && message.embeds.length > 0) {
        const mainEmbed = message.embeds[0];
        const descriptionText = mainEmbed.description || "";
        const authorText = mainEmbed.author?.name || "";
        const fullContent = (descriptionText + " " + authorText).toLowerCase();

        let isMatched = false;
        for (let robloxName of linkedPlayers) {
            if (fullContent.includes(robloxName.toLowerCase())) {
                isMatched = true;
                break;
            }
        }

        if (isMatched) {
            const isPrivate = fullContent.includes("private server");
            
            let targetChannelId;
            if (isPrivate) {
                targetChannelId = process.env.DISCORD_PRIVATE_CHANNEL_ID;
            } else {
                targetChannelId = process.env.DISCORD_CHANNEL_ID;
            }

            const targetChannel = client.channels.cache.get(targetChannelId);
            if (targetChannel) {
                const clonedEmbed = EmbedBuilder.from(mainEmbed);
                targetChannel.send({ 
                    content: `🎉 **New Rare Drop Detected!**`, 
                    embeds: [clonedEmbed] 
                }).catch(console.error);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

