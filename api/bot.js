const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID; 
const CHANNEL_ID = process.env.CHANNEL_ID; 

// Пам'ять бота для збереження кроків (для тестів)
const userState = {}; 

// Функція для створення головного меню з кнопкою Web App
const getMainMenu = () => {
  return Markup.keyboard([
    ['🚨 Повідомити про порушення'],
    // Вставте посилання на ваш майбутній сайт замість https://...
    [Markup.button.webApp('🏆 Мій Ранг та Дошка пошани', 'https://uk.wikipedia.org/wiki/Головна_сторінка')]
  ]).resize(); // resize робить кнопки акуратними
};

// Крок 0: Запуск і запит нікнейму
bot.start((ctx) => {
  const userId = ctx.message.from.id;
  userState[userId] = { step: 'waiting_for_nickname' };
  
  ctx.reply(
    '👋 <b>Вітаємо в системі фіксації ПДР!</b>\n\n' +
    'Щоб почати заробляти бали, придумай собі <b>Нікнейм</b> (під ним ти будеш у топі найкращих):',
    { parse_mode: 'HTML' }
  );
});

// Реакція на кнопку "Повідомити про порушення"
bot.hears('🚨 Повідомити про порушення', (ctx) => {
  const userId = ctx.message.from.id;
  
  // Якщо юзер ще не ввів нік, повертаємо його назад
  if (!userState[userId] || !userState[userId].nickname) {
    userState[userId] = { step: 'waiting_for_nickname' };
    return ctx.reply('Спочатку придумай та введи свій нікнейм:');
  }
  
  userState[userId].step = 'waiting_for_media';
  ctx.reply(
    '📸 <b>Крок 1/3: Фото чи Відео</b>\n\n' +
    'Надішли фото або коротке відео порушення. Бажано, щоб було чітко видно номери.',
    { parse_mode: 'HTML', reply_markup: Markup.removeKeyboard() } // Прибираємо меню, щоб не заважало
  );
});

// Головний "мозок", який обробляє всі повідомлення
bot.on('message', async (ctx) => {
  const userId = ctx.message.from.id;
  const state = userState[userId];

  if (!state) return; // Якщо бот забув юзера, ігноруємо

  // Крок 1: Зберігаємо нікнейм
  if (state.step === 'waiting_for_nickname') {
    if (!ctx.message.text) return ctx.reply('❗️ Будь ласка, введи нікнейм текстом.');
    
    state.nickname = ctx.message.text;
    state.step = 'idle'; // Чекаємо дій
    
    return ctx.reply(
      `✅ Чудово, <b>${state.nickname}</b>! Тепер ти в грі.\n\n` +
      'Використовуй меню нижче, щоб відправити порушення або перевірити свій ранг.',
      { parse_mode: 'HTML', ...getMainMenu() }
    );
  }

  // Крок 2: Отримуємо фото/відео і питаємо номер
  if (state.step === 'waiting_for_media') {
    if (ctx.message.photo) {
      state.mediaId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      state.mediaType = 'photo';
    } else if (ctx.message.video) {
      state.mediaId = ctx.message.video.file_id;
      state.mediaType = 'video';
    } else {
      return ctx.reply('❗️ Будь ласка, надішли саме фото або відео.');
    }
    
    state.step = 'waiting_for_plate';
    return ctx.reply(
      '🚗 <b>Крок 2/3: Номер авто</b>\n\n' +
      'Напиши номер автомобіля порушника (наприклад: КА1234АА):',
      { parse_mode: 'HTML' }
    );
  }

  // Крок 3: Отримуємо номер і питаємо локацію
  if (state.step === 'waiting_for_plate') {
    if (!ctx.message.text) return ctx.reply('❗️ Будь ласка, введи номер текстом.');
    
    state.plate = ctx.message.text.toUpperCase();
    state.step = 'waiting_for_location';
    
    return ctx.reply(
      '📍 <b>Крок 3/3: Місце порушення</b>\n\n' +
      'Напиши адресу (наприклад: Хмельницький, вул. Проскурівська 1) або відправ геолокацію з телефону:',
      { parse_mode: 'HTML' }
    );
  }

  // Крок 4: Отримуємо локацію і формуємо звіт для АДМІНА
  if (state.step === 'waiting_for_location') {
    if (ctx.message.location) {
      state.location = `Геоточка: ${ctx.message.location.latitude}, ${ctx.message.location.longitude}`;
    } else if (ctx.message.text) {
      state.location = ctx.message.text;
    } else {
      return ctx.reply('❗️ Надішли адресу текстом або геолокацію.');
    }

    state.step = 'idle'; // Завершили збір
    await ctx.reply('⏳ Формуємо звіт та відправляємо модератору...', getMainMenu());

    // Красиве повідомлення для вас в адмінці
    const caption = `🚨 <b>НОВЕ ПОРУШЕННЯ</b>\n\n` +
                    `👤 <b>Від:</b> ${state.nickname} (ID: ${userId})\n` +
                    `🚗 <b>Номер:</b> ${state.plate}\n` +
                    `📍 <b>Місце:</b> ${state.location}`;

    const adminKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Опублікувати', `pub_${userId}_${state.plate}`),
        Markup.button.callback('❌ Відхилити', `rej_${userId}`)
      ]
    ]);

    // Відправляємо залежно від того, що це: фото чи відео
    if (state.mediaType === 'photo') {
      await ctx.telegram.sendPhoto(ADMIN_ID, state.mediaId, { caption, parse_mode: 'HTML', ...adminKeyboard });
    } else {
      await ctx.telegram.sendVideo(ADMIN_ID, state.mediaId, { caption, parse_mode: 'HTML', ...adminKeyboard });
    }
  }
});

// Кнопка "Опублікувати" (для адміна)
bot.action(/pub_(.+)_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  const plate = ctx.match[2];
  
  const msg = ctx.callbackQuery.message;
  let mediaId, method;
  if (msg.photo) {
    mediaId = msg.photo[msg.photo.length - 1].file_id;
    method = 'sendPhoto';
  } else if (msg.video) {
    mediaId = msg.video.file_id;
    method = 'sendVideo';
  }
  
  try {
    const publicCaption = `🚗 <b>Зафіксовано порушення!</b>\n\n` +
                          `🔢 <b>Номер:</b> ${plate}\n` +
                          `📍 <b>Надіслав:</b> анонімний спостерігач`;
                          
    await ctx.telegram[method](CHANNEL_ID, mediaId, { caption: publicCaption, parse_mode: 'HTML' });
    await ctx.telegram.sendMessage(userId, '🎉 <b>Твій матеріал опубліковано!</b>\n+10 балів до твого рангу.', { parse_mode: 'HTML' });
    await ctx.editMessageCaption('✅ Опубліковано в канал.');
  } catch (error) {
    await ctx.reply('Помилка публікації. Перевірте права бота в каналі.');
  }
});

// Кнопка "Відхилити" (для адміна)
bot.action(/rej_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  await ctx.telegram.sendMessage(userId, '❌ Модератор відхилив матеріал (можливо, не видно номерів або це не є порушенням).');
  await ctx.editMessageCaption('❌ Відхилено.');
});

module.exports = async (req, res) => {
  try { await bot.handleUpdate(req.body); } 
  finally { res.status(200).send('OK'); }
};
