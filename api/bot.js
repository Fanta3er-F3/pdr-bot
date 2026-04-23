const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID; 
const CHANNEL_ID = process.env.CHANNEL_ID; 

// Команда /start
bot.start((ctx) => {
  ctx.reply('Привіт! Надсилай сюди фото порушень ПДР. Якщо модератор їх схвалить, вони потраплять у канал, а ти отримаєш бали!');
});

// Обробка вхідних фотографій від користувачів
bot.on('photo', async (ctx) => {
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  const userId = ctx.message.from.id;

  // Відповідаємо користувачу
  await ctx.reply('📸 Фото отримано! Передано на перевірку модератору.');

  // Відправляємо фото в адмінку (тепер у кнопках ховаємо ТІЛЬКИ ID юзера, щоб не перевищити ліміт)
  await ctx.telegram.sendPhoto(ADMIN_ID, fileId, {
    caption: `🚨 Нове порушення!\nВід користувача з ID: ${userId}\nЩо робимо з цим фото?`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Опублікувати', callback_data: `pub_${userId}` },
          { text: '❌ Відхилити', callback_data: `rej_${userId}` }
        ]
      ]
    }
  });
});

// Якщо модератор натиснув "Опублікувати"
bot.action(/pub_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  
  // Беремо ID фотографії прямо з повідомлення, під яким натиснута кнопка
  const photoArray = ctx.callbackQuery.message.photo;
  const fileId = photoArray[photoArray.length - 1].file_id;
  
  try {
    // 1. Відправляємо в основний канал
    await ctx.telegram.sendPhoto(CHANNEL_ID, fileId, {
      caption: `🚗 Зафіксовано нове порушення!\n📍 Надіслав: анонімний спостерігач.`
    });
    
    // 2. Сповіщаємо юзера
    await ctx.telegram.sendMessage(userId, '🎉 Ваше фото схвалено та опубліковано! +10 балів до вашого рангу.');
    
    // 3. Змінюємо повідомлення в адмінці, щоб кнопки зникли
    await ctx.editMessageCaption('✅ Успішно опубліковано в канал.');
  } catch (error) {
    console.error(error);
    await ctx.reply('Помилка публікації. Перевірте, чи є бот адміністратором каналу.');
  }
});

// Якщо модератор натиснув "Відхилити"
bot.action(/rej_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  
  // Сповіщаємо юзера
  await ctx.telegram.sendMessage(userId, '❌ На жаль, модератор відхилив ваше фото (не видно номерів або немає порушення).');
  
  // Змінюємо статус в адмінці
  await ctx.editMessageCaption('❌ Відхилено модератором.');
});

module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
  } finally {
    res.status(200).send('OK');
  }
};
