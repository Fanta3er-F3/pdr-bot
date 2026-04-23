const { Telegraf } = require('telegraf');

// Беремо ключі доступу з налаштувань Vercel
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID; // Ваш ID в Телеграмі
const CHANNEL_ID = process.env.CHANNEL_ID; // ID вашого каналу (наприклад, @my_pdr_channel)

// Команда /start
bot.start((ctx) => {
  ctx.reply('Привіт! Надсилай сюди фото порушень ПДР. Якщо модератор їх схвалить, вони потраплять у канал, а ти отримаєш бали!');
});

// Обробка вхідних фотографій від користувачів
bot.on('photo', async (ctx) => {
  // Беремо фото найкращої якості (останнє в масиві)
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  const userId = ctx.message.from.id;

  // Відповідаємо користувачу
  await ctx.reply('📸 Фото отримано! Передано на перевірку модератору.');

  // Відправляємо фото вам в адмінку з кнопками
  await ctx.telegram.sendPhoto(ADMIN_ID, fileId, {
    caption: `🚨 Нове порушення!\nВід користувача з ID: ${userId}\nЩо робимо з цим фото?`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Опублікувати', callback_data: `pub_${fileId}_${userId}` },
          { text: '❌ Відхилити', callback_data: `rej_${fileId}_${userId}` }
        ]
      ]
    }
  });
});

// Якщо модератор натиснув "Опублікувати"
bot.action(/pub_(.+)_(.+)/, async (ctx) => {
  const fileId = ctx.match[1];
  const userId = ctx.match[2];
  
  try {
    // 1. Відправляємо в основний канал
    await ctx.telegram.sendPhoto(CHANNEL_ID, fileId, {
      caption: `🚗 Зафіксовано нове порушення!\n📍 Надіслав: анонімний спостерігач.`
    });
    
    // 2. Сповіщаємо юзера і "даємо бали" (поки просто текстом)
    await ctx.telegram.sendMessage(userId, '🎉 Ваше фото схвалено та опубліковано! +10 балів до вашого рангу.');
    
    // 3. Змінюємо повідомлення в адмінці, щоб кнопки зникли
    await ctx.editMessageCaption('✅ Успішно опубліковано в канал.');
  } catch (error) {
    console.error(error);
    await ctx.reply('Помилка публікації. Перевірте, чи є бот адміністратором каналу.');
  }
});

// Якщо модератор натиснув "Відхилити"
bot.action(/rej_(.+)_(.+)/, async (ctx) => {
  const userId = ctx.match[2];
  
  // Сповіщаємо юзера
  await ctx.telegram.sendMessage(userId, '❌ На жаль, модератор відхилив ваше фото (не видно номерів або немає порушення).');
  
  // Змінюємо статус в адмінці
  await ctx.editMessageCaption('❌ Відхилено модератором.');
});

// Обов'язкова частина для роботи на Vercel (Webhooks)
module.exports = async (req, res) => {
  try {
    // Передаємо вхідний запит від Telegram у нашого бота
    await bot.handleUpdate(req.body);
  } finally {
    // Завжди відповідаємо статус 200, щоб Telegram не дублював повідомлення
    res.status(200).send('OK');
  }
};
