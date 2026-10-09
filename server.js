const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();

// 🚨 هادو هما السطرين اللي كانوا ناقصين وقاعدين يسببو المشكل 🚨
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// تقديم الملفات الثابتة (مثل index.html واللواحق)
app.use(express.static(path.join(__dirname)));

// 1. مسار توجيه المستخدم لصفحة ديسكورد للتسجيل
app.get('/api/auth/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

// 2. مسار الاستقبال بعد موافقة المستخدم فـ ديسكورد
app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) return res.status(400).send('كود التفويض مفقود');

    try {
        // تبديل الكود بـ Access Token
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token } = tokenResponse.data;

        // جلب بيانات المستخدم
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        const user = userResponse.data;

        // جلب بيانات العضو والدور (Roles) من السيرفر باستخدام Bot Token
        const guildMemberResponse = await axios.get(
            `https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${user.id}`,
            { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
        );

        const memberData = guildMemberResponse.data;

        // جلب قائمة كل الرتب فـ السيرفر باش نجيبو أسمائها
        const guildRolesResponse = await axios.get(
            `https://discord.com/api/guilds/${process.env.GUILD_ID}/roles`,
            { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
        );
        const allRoles = guildRolesResponse.data;

        // مطابقة رتب العضو مع أسمائها وتصفية رتبة @everyone
        const userRoles = allRoles
            .filter(role => memberData.roles.includes(role.id) && role.name !== '@everyone')
            .sort((a, b) => b.position - a.position);

        // أخذ أعلى رتبة يملكها المستخدم
        const topRole = userRoles.length > 0 ? userRoles[0].name : 'عضو عادي';

        // رابط الصورة
        const avatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        // التوجيه للموقع مع إرسال اسم الرتبة فـ الـ URL
        return res.redirect(`/?login=success&user=${encodeURIComponent(user.username)}&avatar=${encodeURIComponent(avatarUrl)}&role=${encodeURIComponent(topRole)}`);

    } catch (error) {
        console.error('خطأ فـ المصادقة أو جلب الرتب:', error.response?.data || error.message);
        return res.redirect('/?login=not_member');
    }
});

// مسار استقبال طلبات الخدمات وإرسالها لـ Discord Webhook
app.post('/api/order', async (req, res) => {
  const { service, icName, discordUser, icPhone, details } = req.body;

  if (!service || !icName || !discordUser) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال جميع الحقول المطلوبة!' });
  }

  // توليد كود طلب فريد تلقائياً (مثال: AV-4821)
  const orderId = 'AV-' + Math.floor(1000 + Math.random() * 9000);

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'AVORA Orders System',
          avatar_url: 'https://j.top4top.io/p_3933fpbmb1.png',
          embeds: [{
            title: `📥 طلب خدمة جديد: \${service}`,
            color: 16738560,
            fields: [
              { name: '🔑 كود الطلب', value: `\`#${orderId}\``, inline: true },
              { name: '👤 العميل (IC)', value: icName, inline: true },
              { name: '💬 الديسكورد', value: `@${discordUser}`, inline: true },
              { name: '📞 رقم الهاتف', value: icPhone || 'غير محدد', inline: true },
              { name: '🛠️ الخدمة', value: service, inline: true },
              { name: '📜 التفاصيل / الملاحظات', value: details || 'لا توجد ملاحظات إضافية' }
            ],
            footer: { text: 'AVORA Agency • Executive Management' },
            timestamp: new Date().toISOString()
          }]
        })
      });
    } catch (err) {
      console.error('Webhook Error:', err);
    }
  }

  res.json({
    success: true,
    orderId: orderId,
    message: 'تم إرسال طلبك بنجاح إلى طاقم AVORA!'
  });
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on: http://localhost:${PORT}`);
});
