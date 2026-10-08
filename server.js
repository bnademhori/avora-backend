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
        return res.status(400).json({ success: false, message: 'يرجى ملء جميع الحقول المطلوبة' });
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error('❌ DISCORD_WEBHOOK_URL غير معرف فـ ملف .env!');
        return res.status(500).json({ success: false, message: 'رابط الـ Webhook غير معرف في ملف .env' });
    }

    const logoUrl = "https://j.top4top.io/p_3933fpbmb1.png";

    const embedPayload = {
        username: "AVORA Agency System",
        avatar_url: logoUrl,
        embeds: [{
            title: "💎 NEW SERVICE REQUEST | طلب خدمة جديد",
            description: "--------------------------------------------------\n**تم استلام طلب جديد من الموقع الرسمي للوكالة**",
            color: 16738560, // البرتقالي (#FF6B00)
            fields: [
                {
                    name: "📌 الخدمة المطلوبة",
                    value: service,
                    inline: true
                },
                {
                    name: "📊 حالة الطلب",
                    value: "🟡 قيد المراجعة (Pending)",
                    inline: true
                },
                {
                    name: "👤 بيانات العميل (IC & Discord)",
                    value: `• **الاسم فـ اللعبة:** ${icName}\n• **حساب الديسكورد:** ${discordUser}\n• **رقم الهاتف IC:** ${icPhone || 'غير مدخل'}`,
                    inline: false
                },
                {
                    name: "📝 تفاصيل وملاحظات الطلب",
                    value: details || 'لا توجد تفاصيل إضافية مذكورة.',
                    inline: false
                }
            ],
            footer: {
                text: "AVORA Agency • Advanced Order Management • Atlas RP",
                icon_url: logoUrl
            },
            timestamp: new Date().toISOString()
        }]
    };

    try {
        await axios.post(webhookUrl, embedPayload);
        console.log("✅ Webhook sent successfully!");
        return res.json({ success: true, message: 'تم إرسال الطلب بنجاح إلى سيرفر الديسكورد!' });
    } catch (error) {
        console.error('❌ Discord Webhook Error:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'حدث خطأ أثناء إرسال الطلب للسيرفر.' });
    }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on: http://localhost:${PORT}`);
});