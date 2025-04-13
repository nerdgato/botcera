import { Client, GatewayIntentBits, Routes, SlashCommandBuilder, REST, EmbedBuilder } from "discord.js";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const animesFile = "animes.json";

// Cargar animes desde archivo
let animesSeguidos = new Map();
if (fs.existsSync(animesFile)) {
    const data = JSON.parse(fs.readFileSync(animesFile, "utf-8"));
    for (const [animeId, animeData] of Object.entries(data)) {
        animesSeguidos.set(Number(animeId), animeData);
    }
}

// Guardar animes al archivo
function guardarAnimes() {
    const obj = Object.fromEntries(animesSeguidos);
    fs.writeFileSync(animesFile, JSON.stringify(obj, null, 2));
}

// Función para obtener episodios de un anime
async function getAnimeEpisodes(animeId) {
    const response = await axios.get(`https://api.jikan.moe/v4/anime/${animeId}/episodes`);
    return response.data.data;
}

// Función para anunciar un nuevo episodio
async function anunciarNuevoEpisodio(canal, animeId, episodeId) {
  const episodeData = await axios.get(`https://api.jikan.moe/v4/anime/${animeId}/episodes/${episodeId}`);
  const episode = episodeData.data.data;

  const animeData = await axios.get(`https://api.jikan.moe/v4/anime/${animeId}`);
  const anime = animeData.data.data;


  const imagen = anime.images?.jpg?.image_url;  // Imagen del anime
  const episodioNumero = episode.mal_id;
  const animeNombre = anime.title;

  // Comprobar si la imagen existe antes de enviarla
  const embed = new EmbedBuilder()
      .setTitle(`Nuevo episodio disponible de ${animeNombre}!`)
      .setDescription(`¡Ya puedes ver el episodio ${episodioNumero}!\n`)
      .setColor(0xff5e01)
      .setImage(imagen || 'https://default-image-url.com') 
      .setThumbnail('https://i.imgur.com/Ypz67Uv.png');

  await canal.send({ embeds: [embed] });
}


// Esperar X milisegundos
function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Función para verificar nuevos episodios periódicamente con pausa entre animes
setInterval(async () => {
  const canal = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  console.log("🔄 Verificando nuevos episodios...");
  for (const [animeId, data] of animesSeguidos) {
      try {
          const episodios = await getAnimeEpisodes(animeId);
          const ultimo = episodios[episodios.length - 1];

          if (!ultimo) continue;

          if (ultimo.mal_id !== data.lastEpisodeId) {
              console.log(`📢 Nuevo episodio detectado para anime ID ${animeId}: episodio ${ultimo.mal_id}`);

              await anunciarNuevoEpisodio(canal, animeId, ultimo.mal_id);

              animesSeguidos.set(animeId, {
                  lastEpisodeId: ultimo.mal_id,
                  lastEpisodeData: ultimo
              });

              guardarAnimes();
          }
      } catch (err) {
          console.error(`❌ Error al verificar anime ${animeId}:`, err.message);
      }

      // Esperar 5 segundos entre cada anime para evitar saturar la API
      await esperar(5000);
  }
}, 60 * 1000); // Repetir el ciclo completo cada 1 minuto (60 * 1000 ms)

// Comandos
const commands = [
    new SlashCommandBuilder()
        .setName('agregaranime')
        .setDescription('Agrega un nuevo anime por su ID de MyAnimeList')
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('ID del anime en MyAnimeList')
                .setRequired(true)
        )
        .toJSON(),
    new SlashCommandBuilder()
    .setName('ultimoepisodio')
    .setDescription('Muestra el último episodio de un anime dado su ID de MyAnimeList')
    .addIntegerOption(option =>
        option.setName('id')
            .setDescription('ID del anime en MyAnimeList')
            .setRequired(true)
    )
    .toJSON()
];

client.once('ready', () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
});

// Registro de comandos
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
    try {
        console.log('🔁 Registrando comandos...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('✅ Comandos registrados.');
    } catch (err) {
        console.error('❌ Error al registrar comandos:', err);
    }
})();

// Respuesta a comandos
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'agregaranime') {
        const animeId = interaction.options.getInteger('id');

        try {
            const response = await axios.get(`https://api.jikan.moe/v4/anime/${animeId}`);
            const anime = response.data.data;

            const episodes = await getAnimeEpisodes(animeId);
            const latest = episodes[episodes.length - 1] || {};

            animesSeguidos.set(animeId, {
                lastEpisodeId: latest.mal_id || null,
                lastEpisodeData: latest || null
            });
            guardarAnimes();

            await interaction.reply(`✅ Anime **${anime.title}** agregado con éxito.`);
        } catch (error) {
            console.error("❌ Error al agregar anime:", error.message);
            await interaction.reply("❌ No se pudo agregar el anime. Verifica el ID.");
        }

    } else if (interaction.commandName === 'ultimoepisodio') {
      const animeId = interaction.options.getInteger('id');
      const canal = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  
      await interaction.deferReply(); 
  
      try {
          const response = await axios.get(`https://api.jikan.moe/v4/anime/${animeId}`);
          const anime = response.data.data;
  
          const episodes = await getAnimeEpisodes(animeId);
          const latest = episodes[episodes.length - 1];
  
          if (!latest) {
              await interaction.editReply("❌ No se encontraron episodios para este anime.");
              return;
          }
  
          await interaction.editReply('📦 Enviando el último episodio detectado...');
          await anunciarNuevoEpisodio(canal, animeId, latest.mal_id);
  
      } catch (error) {
          console.error("❌ Error al obtener el último episodio:", error.message);
          await interaction.editReply("❌ No se pudo obtener el último episodio. Espera unos segundos e inténtalo de nuevo.");
      }
  }

});

client.login(process.env.TOKEN);
