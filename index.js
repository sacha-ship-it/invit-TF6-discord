const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js')

const TOKEN = process.env.TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const GUILD_ID = process.env.GUILD_ID
const INVITE_CHANNEL_ID = process.env.INVITE_CHANNEL_ID
const STAFF_CHANNEL_ID = process.env.STAFF_CHANNEL_ID

const COLOR = '#00C853'

const PRIZES = {
  1: '100K Instant Account',
  2: '50K Instant Account',
  3: '25K Instant Account'
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ]
})

const inviteCache = new Map()
const inviteCount = new Map()
let scoresMessageId = null

async function saveToDiscord() {
  try {
    const channel = await client.channels.fetch(STAFF_CHANNEL_ID)
    const data = JSON.stringify({
      inviteCount: Object.fromEntries(inviteCount),
      inviteCache: Object.fromEntries(inviteCache)
    })
    const content = 'INVITEDATA:' + data
    if (scoresMessageId) {
      const msg = await channel.messages.fetch(scoresMessageId)
      await msg.edit(content)
    } else {
      const msg = await channel.send(content)
      scoresMessageId = msg.id
    }
  } catch (e) {
    console.error('Save error:', e.message)
  }
}

async function loadFromDiscord() {
  try {
    const channel = await client.channels.fetch(STAFF_CHANNEL_ID)
    const messages = await channel.messages.fetch({ limit: 20 })
    const dataMsg = messages.find(m => m.author.id === client.user.id && m.content.startsWith('INVITEDATA:'))
    if (dataMsg) {
      const parsed = JSON.parse(dataMsg.content.replace('INVITEDATA:', ''))
      if (parsed.inviteCount) {
        Object.entries(parsed.inviteCount).forEach(([key, val]) => inviteCount.set(key, val))
      }
      if (parsed.inviteCache) {
        Object.entries(parsed.inviteCache).forEach(([key, val]) => inviteCache.set(key, val))
      }
      scoresMessageId = dataMsg.id
      console.log('Data loaded')
    }
  } catch (e) {
    console.log('No existing data:', e.message)
  }
}

async function refreshInviteCache(guild) {
  const invites = await guild.invites.fetch()
  invites.forEach(invite => {
    if (!inviteCache.has(invite.code)) {
      inviteCache.set(invite.code, {
        inviterId: invite.inviter?.id,
        inviterUsername: invite.inviter?.username,
        uses: invite.uses
      })
    } else {
      const cached = inviteCache.get(invite.code)
      cached.uses = invite.uses
      inviteCache.set(invite.code, cached)
    }
  })
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Post the invitation contest message'),
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show the invitation leaderboard'),
    new SlashCommandBuilder()
      .setName('resetleaderboard')
      .setDescription('Reset the leaderboard (admin only)'),
  ].map(c => c.toJSON())

  const rest = new REST({ version: '10' }).setToken(TOKEN)
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
  console.log('Commands registered')
}

client.on('ready', async () => {
  console.log(`Bot connected: ${client.user.tag}`)
  await registerCommands()
  await loadFromDiscord()
  const guild = await client.guilds.fetch(GUILD_ID)
  await refreshInviteCache(guild)
})

client.on('inviteCreate', invite => {
  if (!inviteCache.has(invite.code)) {
    inviteCache.set(invite.code, {
      inviterId: invite.inviter?.id,
      inviterUsername: invite.inviter?.username,
      uses: invite.uses
    })
  }
})

client.on('inviteDelete', invite => {
  inviteCache.delete(invite.code)
})

client.on('guildMemberAdd', async member => {
  const guild = member.guild
  const newInvites = await guild.invites.fetch()
  let usedCode = null

  newInvites.forEach(invite => {
    const cached = inviteCache.get(invite.code)
    if (cached && invite.uses > cached.uses) {
      usedCode = invite.code
      cached.uses = invite.uses
      inviteCache.set(invite.code, cached)
    }
  })

  if (usedCode) {
    const cached = inviteCache.get(usedCode)
    if (cached && cached.inviterId) {
      const inviterId = cached.inviterId
      const inviterUsername = cached.inviterUsername || 'Unknown'
      const current = inviteCount.get(inviterId) || { count: 0, username: inviterUsername }
      inviteCount.set(inviterId, {
        count: current.count + 1,
        username: inviterUsername
      })
      await saveToDiscord()
      const staffChannel = await client.channels.fetch(STAFF_CHANNEL_ID)
      await staffChannel.send(`📨 **${member.user.username}** joined via **${inviterUsername}** (<@${inviterId}>) - Total: **${current.count + 1} invitation${current.count + 1 > 1 ? 's' : ''}**`)
    }
  }
})

client.on('interactionCreate', async interaction => {

  if (interaction.isButton() && interaction.customId === 'my_link') {
    const guild = interaction.guild
    const userId = interaction.user.id
    const username = interaction.user.username

    let existingCode = null
    for (const [code, data] of inviteCache.entries()) {
      if (data.inviterId === userId) {
        existingCode = code
        break
      }
    }

    if (existingCode) {
      const count = inviteCount.get(userId)?.count || 0
      return await interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription(`🔗 **Your personal invitation link:**\nhttps://discord.gg/${existingCode}\n\n📊 Invitations: **${count}**\n\nShare it to climb the leaderboard and win your prize!`)
          .setColor(COLOR)],
        ephemeral: true
      })
    }

    const channel = await client.channels.fetch(INVITE_CHANNEL_ID)
    const newInvite = await channel.createInvite({
      maxAge: 0,
      maxUses: 0,
      unique: true,
      reason: `Personal link for ${username}`
    })

    inviteCache.set(newInvite.code, {
      inviterId: userId,
      inviterUsername: username,
      uses: 0
    })

    await saveToDiscord()

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setDescription(`🔗 **Your personal invitation link:**\nhttps://discord.gg/${newInvite.code}\n\nShare it to climb the leaderboard and win your prize!`)
        .setColor(COLOR)],
      ephemeral: true
    })
  }

  if (interaction.isButton() && interaction.customId === 'my_invitations') {
    const userId = interaction.user.id
    const data = inviteCount.get(userId)
    const count = data ? data.count : 0

    const sorted = [...inviteCount.entries()].sort((a, b) => b[1].count - a[1].count)
    const rank = sorted.findIndex(([id]) => id === userId) + 1

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setDescription(`📊 **Your stats**\n\nInvitations: **${count}**\nCurrent rank: **#${rank || '?'}**\n\nKeep going to win your prize!`)
        .setColor(COLOR)],
      ephemeral: true
    })
  }

  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName === 'setup') {
    const channel = await client.channels.fetch(INVITE_CHANNEL_ID)

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('my_link')
        .setLabel('My invitation link')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('my_invitations')
        .setLabel('My invitations')
        .setStyle(ButtonStyle.Primary),
    )

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('TF8 - INVITATION CONTEST')
        .setDescription(
          'Invite as many members as possible to The Floor 8 and win a funded account!\n\n' +
          '**Top 3 winners:**\n\n' +
          '🥇 1st place - **100K Instant Account**\n' +
          '🥈 2nd place - **50K Instant Account**\n' +
          '🥉 3rd place - **25K Instant Account**\n\n' +
          'Click **My invitation link** to get your unique personal link.\n' +
          'Click **My invitations** to check your current score.\n\n' +
          '⚠️ Only members invited through your personal link are counted.'
        )
        .setColor(COLOR)
        .setFooter({ text: 'Good luck to everyone!' })],
      components: [row]
    })

    await interaction.reply({ content: 'Message posted!', ephemeral: true })
  }

  if (interaction.commandName === 'leaderboard') {
    const top = [...inviteCount.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)

    const medals = ['🥇', '🥈', '🥉']
    const leaderboard = top.length
      ? top.map(([id, data], i) => {
          const rank = medals[i] || (i + 1) + '.'
          const prize = PRIZES[i + 1] ? ` - **${PRIZES[i + 1]}**` : ''
          return `${rank} <@${id}> : **${data.count} invitation${data.count > 1 ? 's' : ''}**${prize}`
        }).join('\n')
      : 'No invitations yet.'

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('TF8 - INVITATION CONTEST LEADERBOARD')
        .setDescription(leaderboard)
        .setColor(COLOR)
        .setFooter({ text: 'Top 3 win a funded account!' })],
      ephemeral: false
    })
  }

  if (interaction.commandName === 'resetleaderboard') {
    const member = interaction.guild.members.cache.get(interaction.user.id)
    if (!member.permissions.has('Administrator')) {
      return interaction.reply({ content: 'Permission denied.', ephemeral: true })
    }

    inviteCount.clear()
    scoresMessageId = null
    await saveToDiscord()
    await interaction.reply({ content: 'Leaderboard reset!', ephemeral: true })
  }
})

client.login(TOKEN)
