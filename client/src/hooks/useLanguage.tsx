import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'en' | 'ru' | 'ar';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    // ── Settings ──────────────────────────────────────────────
    settings: 'Settings',
    my_uid: 'My UID',
    language: 'Language',
    contact_support: 'Contact Support',
    legal_info: 'Legal Information',
    terms_conditions: 'Terms & Conditions',
    privacy_policy: 'Privacy Policy',
    acceptable_use: 'Acceptable Use Policy',
    copied: 'Copied to clipboard!',
    close: 'Close',
    english: 'English',
    russian: 'Russian',
    arabic: 'Arabic',
    admin_panel: 'Admin Panel',
    back: 'Back',

    // ── Navigation ────────────────────────────────────────────
    home: 'HOME',
    rank: 'RANK',
    invite: 'INVITE',
    mission: 'MISSION',
    admin: 'ADMIN',

    // ── Home ──────────────────────────────────────────────────
    balance: 'BALANCE',
    withdraw_upper: 'WITHDRAW',
    swap: 'SWAP',
    weekly_contest: 'WEEKLY CONTEST',
    top_earners: 'Top Earners',
    take_the_prize: 'take the prize',
    prize_pool: 'PRIZE POOL',
    income_statistics: 'INCOME STATISTICS',
    today: 'Today',
    weekly: 'Weekly',
    monthly: 'Monthly',
    all_time: 'All-Time',
    streak: 'Streak',
    days: 'days',
    leaderboard: 'Leaderboard',
    weekly_prize: 'Weekly Prize',
    watch_ads: 'Watch Ads',
    earn_pow: 'Earn POW',
    daily_limit: 'Daily Limit',
    watch: 'Watch',
    watching: 'Watching...',
    claim: 'Claim',
    claimed: 'Claimed',

    // ── Ad Watching Section ───────────────────────────────────
    viewing_ads: 'Viewing Ads',
    get_paid_watching: 'Get paid for watching short Ads on Telegram.',
    start_earning: 'Start Earning',
    loading_ad: 'Loading Ad...',
    verifying: 'Verifying...',
    daily_limit_reached_tomorrow: 'Daily limit reached. Resets tomorrow.',
    hourly_limit_reached: 'Hourly limit reached. Refills in ~1 hour.',
    ads_available_label: 'ads available',
    today_label: 'today',

    // ── Affiliates ────────────────────────────────────────────
    affiliates: 'Affiliates',
    affiliates_program: 'Affiliates Program',
    we_pay_out: 'We pay out up to',
    from_l1_income: 'from the income of referrals of the 1st level and up to',
    from_l2_income: 'from the income of referrals of the 2nd level.',
    copy: 'COPY',
    level1_referrals: 'Level 1 Referrals',
    of_friends_pow: 'of your friends POW',
    from_their_friends: 'from their friends',
    get_label: 'Get',
    level2_referrals: 'Level 2 Referrals',
    bonus: 'Bonus',
    when_friend_watches: 'When your friend watches 1 ad',
    disabled: 'Disabled',
    total_affiliate_earnings: 'Total Affiliate Earnings',
    usd_earned: 'USD Earned',
    total_from_referrals: 'Total from all referrals',
    pow_earned: 'POW Earned',
    total_pow_l1: 'Total POW from L1 commissions',
    link_copied: 'Link copied!',
    referral_link: 'Referral Link',
    copy_link: 'Copy Link',
    friends_invited: 'Friends Invited',
    total_earned: 'Total Earned',
    invite_friends: 'Invite Friends',
    how_it_works: 'How It Works',

    // ── Withdraw ──────────────────────────────────────────────
    withdraw: 'Withdraw',
    withdrawal: 'Withdrawal',
    amount: 'Amount',
    wallet_address: 'Wallet Address',
    submit: 'Submit',
    minimum: 'Minimum',
    available: 'Available',
    history: 'History',
    pending: 'Pending',
    completed: 'Completed',
    rejected: 'Rejected',
    checking_requirements: 'Checking requirements...',
    pending_withdrawal_warning: 'You have a pending withdrawal. Please wait for it to be processed.',
    select_withdrawal_package: 'Select Withdrawal Package',
    full_balance: 'FULL BALANCE',
    you_will_receive: 'You will receive',
    withdrawal_method: 'Withdrawal method',
    to_withdraw_need: 'To withdraw you need:',
    wallet_activity: 'Wallet Activity',
    no_transactions_yet: 'No transactions yet',
    withdrawal_history_here: 'Your withdrawal history will appear here',
    connect: 'Connect',
    fee_label: 'fee',
    select_package: 'Select a Package',
    insufficient_balance: 'Insufficient Balance',
    requirements_not_met: 'Requirements Not Met',
    withdrawal_request_sent: 'You have sent a withdrawal request.',
    friends: 'friends',
    friend: 'friend',
    ads_count: 'ads',
    ad_count: 'ad',
    ads_watched_progress: 'ads watched',
    more_ads_to_watch: 'more to go',
    full_balance_lower: 'Full balance',
    via: 'via',

    // ── Leaderboard ───────────────────────────────────────────
    this_week: '⭐ This Week',
    last_week: '🗓 Last Week',
    contest_ends_in: 'Contest ends in',
    last_week_final: "🏁 Last week's final results",
    weekly_prize_pool: 'Weekly Prize Pool',
    last_week_prize: 'Last Week Prize',
    top_10_winners: 'Top 10 winners',
    earn_stars_by: 'Earn Stars by watching ads',
    no_data_last_week: 'No data for last week',
    no_participants_yet: 'No participants yet',
    last_week_no_data: 'Last week had no contest data.',
    watch_to_top_spot: 'Watch ads to earn Stars and claim the top spot!',
    top_10_players: 'TOP 10 PLAYERS',
    you_label: 'YOU',
    your_rank: 'YOUR RANK',
    keep_watching_climb: 'Keep watching to climb!',
    this_week_label: 'this week',
    not_ranked_yet: 'Not ranked yet this week',
    watch_to_enter: 'Watch ads to earn Stars and enter the contest',
    you_are_winning: "You're winning",

    // ── Missions ──────────────────────────────────────────────
    missions: 'Missions',
    mission_title: 'Mission',
    complete_tasks_earn: 'Complete tasks and earn POW rewards',
    promo_code_label: 'Promo Code',
    earn_with_ads: 'Earn with ADS',
    all_tasks_label: 'All Tasks',
    all_tab: 'All',
    daily_tab: 'Daily',
    partner_tab: 'Partner',
    no_tasks_available: 'No tasks available right now',
    come_back_tomorrow: 'come back tomorrow',
    no_ad_available: 'No ad available right now, try again later',
    watch_full_ad: 'Please watch the full ad to earn',
    something_went_wrong: 'Something went wrong',
    coming_soon_label: 'Coming Soon',
    i_want_task_here: 'I want my task here',
    create_your_own_task: 'create your own task',
    done_label: 'DONE',
    watch_label: 'WATCH',
    channel_label: 'Channel',
    bot_website_label: 'Bot / Website',
    partner_label: 'Partner',
    claim_label: 'CLAIM',
    loading_ellipsis: 'Loading…',
    share_with_friends: 'Share with Friends',
    daily_checkin: 'Daily Check-in',
    check_for_updates: 'Check for Updates',
    reward: 'Reward',
    go: 'Go',
    share: 'Share',
    daily_limit_short: 'Daily limit reached',
    per_day: '/day',

    // ── Ban Screen ────────────────────────────────────────────
    account_banned_msg: 'Your account has been banned due to suspicious multi-account activity',
    ban_details: 'Details:',
    all_features_disabled: 'All features are disabled. If you believe this is a mistake, please contact our',
    support_team: 'support team',
    admin_self_unban: 'Admin Self-Unban',
    unbanned_successfully: 'Successfully unbanned! Reloading...',

    // ── Country Blocked ───────────────────────────────────────
    not_available: 'Not Available',
    not_available_country: 'This app is not available in your country.',

    // ── Join popup ────────────────────────────────────────────
    join_required: '🔒 Join Required',
    join_required_desc: 'To continue using PaidAdz, you must join our official Channel and Community Group.',
    join_channel: '📢 Join Channel',
    join_group: '💬 Join Group',
    verify_membership: '✅ Verify Membership',
    not_member_yet: 'Please join both the channel and group first, then tap Verify.',

    // ── General ───────────────────────────────────────────────
    loading: 'Loading...',
    error: 'Error',
    retry: 'Retry',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    success: 'Success',
    failed: 'Failed',
    processing: 'Processing...',
    select_language: 'Select Language',
    language_changed: 'Language changed!',
  },

  ru: {
    // ── Settings ──────────────────────────────────────────────
    settings: 'Настройки',
    my_uid: 'Мой UID',
    language: 'Язык',
    contact_support: 'Поддержка',
    legal_info: 'Юридическая информация',
    terms_conditions: 'Условия и положения',
    privacy_policy: 'Политика конфиденциальности',
    acceptable_use: 'Правила использования',
    copied: 'Скопировано!',
    close: 'Закрыть',
    english: 'Английский',
    russian: 'Русский',
    arabic: 'Арабский',
    admin_panel: 'Панель администратора',
    back: 'Назад',

    // ── Navigation ────────────────────────────────────────────
    home: 'ГЛАВНАЯ',
    rank: 'РЕЙТИНГ',
    invite: 'ПРИГЛАСИТЬ',
    mission: 'ЗАДАНИЯ',
    admin: 'ADMIN',

    // ── Home ──────────────────────────────────────────────────
    balance: 'БАЛАНС',
    withdraw_upper: 'ВЫВОД',
    swap: 'ОБМЕН',
    weekly_contest: 'КОНКУРС НЕДЕЛИ',
    top_earners: 'Лучшие участники',
    take_the_prize: 'забирают приз',
    prize_pool: 'ПРИЗОВОЙ ФОНД',
    income_statistics: 'СТАТИСТИКА ДОХОДА',
    today: 'Сегодня',
    weekly: 'За неделю',
    monthly: 'За месяц',
    all_time: 'За всё время',
    streak: 'Серия',
    days: 'дней',
    leaderboard: 'Таблица лидеров',
    weekly_prize: 'Еженедельный приз',
    watch_ads: 'Смотреть рекламу',
    earn_pow: 'Заработать POW',
    daily_limit: 'Дневной лимит',
    watch: 'Смотреть',
    watching: 'Просмотр...',
    claim: 'Получить',
    claimed: 'Получено',

    // ── Ad Watching Section ───────────────────────────────────
    viewing_ads: 'Просмотр рекламы',
    get_paid_watching: 'Получайте деньги за просмотр коротких реклам в Telegram.',
    start_earning: 'Начать зарабатывать',
    loading_ad: 'Загрузка рекламы...',
    verifying: 'Проверяем...',
    daily_limit_reached_tomorrow: 'Дневной лимит исчерпан. Сбросится завтра.',
    hourly_limit_reached: 'Часовой лимит исчерпан. Обновится через ~1 час.',
    ads_available_label: 'реклам доступно',
    today_label: 'сегодня',

    // ── Affiliates ────────────────────────────────────────────
    affiliates: 'Партнёры',
    affiliates_program: 'Партнёрская программа',
    we_pay_out: 'Мы выплачиваем до',
    from_l1_income: 'от дохода рефералов 1-го уровня и до',
    from_l2_income: 'от дохода рефералов 2-го уровня.',
    copy: 'КОПИРОВАТЬ',
    level1_referrals: 'Рефералы 1-го уровня',
    of_friends_pow: 'от POW ваших друзей',
    from_their_friends: 'от доходов их друзей',
    get_label: 'Получайте',
    level2_referrals: 'Рефералы 2-го уровня',
    bonus: 'Бонус',
    when_friend_watches: 'Когда ваш друг посмотрит 1 рекламу',
    disabled: 'Отключено',
    total_affiliate_earnings: 'Всего заработано с партнёров',
    usd_earned: 'Заработано USD',
    total_from_referrals: 'Итого от всех рефералов',
    pow_earned: 'Заработано POW',
    total_pow_l1: 'Всего POW от комиссий L1',
    link_copied: 'Ссылка скопирована!',
    referral_link: 'Реферальная ссылка',
    copy_link: 'Копировать ссылку',
    friends_invited: 'Приглашено друзей',
    total_earned: 'Всего заработано',
    invite_friends: 'Пригласить друзей',
    how_it_works: 'Как это работает',

    // ── Withdraw ──────────────────────────────────────────────
    withdraw: 'Вывод',
    withdrawal: 'Вывод средств',
    amount: 'Сумма',
    wallet_address: 'Адрес кошелька',
    submit: 'Отправить',
    minimum: 'Минимум',
    available: 'Доступно',
    history: 'История',
    pending: 'В обработке',
    completed: 'Завершено',
    rejected: 'Отклонено',
    checking_requirements: 'Проверка условий...',
    pending_withdrawal_warning: 'У вас есть незавершённый вывод. Пожалуйста, дождитесь его обработки.',
    select_withdrawal_package: 'Выберите сумму вывода',
    full_balance: 'ВЕСЬ БАЛАНС',
    you_will_receive: 'Вы получите',
    withdrawal_method: 'Способ вывода',
    to_withdraw_need: 'Для вывода необходимо:',
    wallet_activity: 'Активность кошелька',
    no_transactions_yet: 'Транзакций пока нет',
    withdrawal_history_here: 'История ваших выводов появится здесь',
    connect: 'Подключить',
    fee_label: 'комиссия',
    select_package: 'Выберите пакет',
    insufficient_balance: 'Недостаточно средств',
    requirements_not_met: 'Условия не выполнены',
    withdrawal_request_sent: 'Запрос на вывод отправлен.',
    friends: 'друзей',
    friend: 'друга',
    ads_count: 'реклам',
    ad_count: 'реклам',
    ads_watched_progress: 'реклам просмотрено',
    more_ads_to_watch: 'осталось',
    full_balance_lower: 'Весь баланс',
    via: 'через',

    // ── Leaderboard ───────────────────────────────────────────
    this_week: '⭐ Эта неделя',
    last_week: '🗓 Прошлая неделя',
    contest_ends_in: 'Конкурс заканчивается через',
    last_week_final: '🏁 Итоги прошлой недели',
    weekly_prize_pool: 'Призовой фонд недели',
    last_week_prize: 'Приз прошлой недели',
    top_10_winners: 'Топ-10 победителей',
    earn_stars_by: 'Зарабатывайте звёзды, смотря рекламу',
    no_data_last_week: 'Нет данных за прошлую неделю',
    no_participants_yet: 'Участников пока нет',
    last_week_no_data: 'На прошлой неделе данных конкурса не было.',
    watch_to_top_spot: 'Смотрите рекламу, чтобы заработать звёзды и занять первое место!',
    top_10_players: 'ТОП 10 ИГРОКОВ',
    you_label: 'ВЫ',
    your_rank: 'ВАШ РЕЙТИНГ',
    keep_watching_climb: 'Продолжайте смотреть, чтобы подняться!',
    this_week_label: 'на этой неделе',
    not_ranked_yet: 'Ещё не в рейтинге на этой неделе',
    watch_to_enter: 'Смотрите рекламу, чтобы заработать звёзды и войти в конкурс',
    you_are_winning: 'Вы выигрываете',

    // ── Missions ──────────────────────────────────────────────
    missions: 'Задания',
    mission_title: 'Задания',
    complete_tasks_earn: 'Выполняйте задания и зарабатывайте POW',
    promo_code_label: 'Промокод',
    earn_with_ads: 'Заработок с РЕКЛАМОЙ',
    all_tasks_label: 'Все задания',
    all_tab: 'Все',
    daily_tab: 'Ежедневные',
    partner_tab: 'Партнёры',
    no_tasks_available: 'Сейчас нет доступных заданий',
    come_back_tomorrow: 'возвращайтесь завтра',
    no_ad_available: 'Реклама недоступна, попробуйте позже',
    watch_full_ad: 'Пожалуйста, досмотрите рекламу до конца',
    something_went_wrong: 'Что-то пошло не так',
    coming_soon_label: 'Скоро',
    i_want_task_here: 'Хочу разместить задание здесь',
    create_your_own_task: 'создайте своё задание',
    done_label: 'ГОТОВО',
    watch_label: 'СМОТРЕТЬ',
    channel_label: 'Канал',
    bot_website_label: 'Бот / Сайт',
    partner_label: 'Партнёр',
    claim_label: 'ПОЛУЧИТЬ',
    loading_ellipsis: 'Загрузка…',
    share_with_friends: 'Поделиться с друзьями',
    daily_checkin: 'Ежедневный вход',
    check_for_updates: 'Проверить обновления',
    reward: 'Награда',
    go: 'Перейти',
    share: 'Поделиться',
    daily_limit_short: 'Дневной лимит исчерпан',
    per_day: '/день',

    // ── Ban Screen ────────────────────────────────────────────
    account_banned_msg: 'Ваш аккаунт заблокирован из-за подозрительной активности с несколькими аккаунтами',
    ban_details: 'Подробности:',
    all_features_disabled: 'Все функции отключены. Если вы считаете, что это ошибка, свяжитесь с нашей',
    support_team: 'службой поддержки',
    admin_self_unban: 'Разблокировать (Админ)',
    unbanned_successfully: 'Разблокировано! Перезагрузка...',

    // ── Country Blocked ───────────────────────────────────────
    not_available: 'Недоступно',
    not_available_country: 'Это приложение недоступно в вашей стране.',

    // ── Join popup ────────────────────────────────────────────
    join_required: '🔒 Требуется вступление',
    join_required_desc: 'Чтобы продолжить использование PaidAdz, вы должны вступить в наш официальный канал и группу сообщества.',
    join_channel: '📢 Вступить в канал',
    join_group: '💬 Вступить в группу',
    verify_membership: '✅ Подтвердить членство',
    not_member_yet: 'Сначала вступите в канал и группу, затем нажмите «Подтвердить».',

    // ── General ───────────────────────────────────────────────
    loading: 'Загрузка...',
    error: 'Ошибка',
    retry: 'Повторить',
    save: 'Сохранить',
    cancel: 'Отмена',
    confirm: 'Подтвердить',
    success: 'Успешно',
    failed: 'Не удалось',
    processing: 'Обработка...',
    select_language: 'Выберите язык',
    language_changed: 'Язык изменён!',
  },

  ar: {
    // ── Settings ──────────────────────────────────────────────
    settings: 'الإعدادات',
    my_uid: 'معرّفي',
    language: 'اللغة',
    contact_support: 'التواصل مع الدعم',
    legal_info: 'المعلومات القانونية',
    terms_conditions: 'الشروط والأحكام',
    privacy_policy: 'سياسة الخصوصية',
    acceptable_use: 'سياسة الاستخدام المقبول',
    copied: 'تم النسخ!',
    close: 'إغلاق',
    english: 'الإنجليزية',
    russian: 'الروسية',
    arabic: 'العربية',
    admin_panel: 'لوحة الإدارة',
    back: 'رجوع',

    // ── Navigation ────────────────────────────────────────────
    home: 'الرئيسية',
    rank: 'الترتيب',
    invite: 'دعوة',
    mission: 'المهام',
    admin: 'مدير',

    // ── Home ──────────────────────────────────────────────────
    balance: 'الرصيد',
    withdraw_upper: 'سحب',
    swap: 'تحويل',
    weekly_contest: 'مسابقة الأسبوع',
    top_earners: 'أعلى المكتسبين',
    take_the_prize: 'يفوزون بالجائزة',
    prize_pool: 'مجموع الجوائز',
    income_statistics: 'إحصائيات الدخل',
    today: 'اليوم',
    weekly: 'أسبوعي',
    monthly: 'شهري',
    all_time: 'كل الوقت',
    streak: 'التسلسل',
    days: 'أيام',
    leaderboard: 'لوحة المتصدرين',
    weekly_prize: 'الجائزة الأسبوعية',
    watch_ads: 'مشاهدة الإعلانات',
    earn_pow: 'اكسب POW',
    daily_limit: 'الحد اليومي',
    watch: 'شاهد',
    watching: 'جارٍ المشاهدة...',
    claim: 'استلام',
    claimed: 'تم الاستلام',

    // ── Ad Watching Section ───────────────────────────────────
    viewing_ads: 'مشاهدة الإعلانات',
    get_paid_watching: 'احصل على أموال مقابل مشاهدة إعلانات قصيرة على تيليغرام.',
    start_earning: 'ابدأ الكسب',
    loading_ad: 'جارٍ تحميل الإعلان...',
    verifying: 'جارٍ التحقق...',
    daily_limit_reached_tomorrow: 'تم الوصول للحد اليومي. يُعاد غداً.',
    hourly_limit_reached: 'تم الوصول للحد الساعي. يُعاد خلال ~ساعة.',
    ads_available_label: 'إعلانات متاحة',
    today_label: 'اليوم',

    // ── Affiliates ────────────────────────────────────────────
    affiliates: 'الشركاء',
    affiliates_program: 'برنامج الشراكة',
    we_pay_out: 'ندفع حتى',
    from_l1_income: 'من دخل إحالات المستوى الأول وحتى',
    from_l2_income: 'من دخل إحالات المستوى الثاني.',
    copy: 'نسخ',
    level1_referrals: 'إحالات المستوى 1',
    of_friends_pow: 'من POW أصدقائك',
    from_their_friends: 'من دخل أصدقائهم',
    get_label: 'احصل على',
    level2_referrals: 'إحالات المستوى 2',
    bonus: 'مكافأة',
    when_friend_watches: 'عندما يشاهد صديقك إعلاناً واحداً',
    disabled: 'معطّل',
    total_affiliate_earnings: 'إجمالي أرباح الشراكة',
    usd_earned: 'الدولارات المكتسبة',
    total_from_referrals: 'الإجمالي من جميع الإحالات',
    pow_earned: 'POW المكتسب',
    total_pow_l1: 'إجمالي POW من عمولات L1',
    link_copied: 'تم نسخ الرابط!',
    referral_link: 'رابط الإحالة',
    copy_link: 'نسخ الرابط',
    friends_invited: 'الأصدقاء المدعوون',
    total_earned: 'إجمالي الأرباح',
    invite_friends: 'دعوة الأصدقاء',
    how_it_works: 'كيف يعمل',

    // ── Withdraw ──────────────────────────────────────────────
    withdraw: 'سحب',
    withdrawal: 'عملية السحب',
    amount: 'المبلغ',
    wallet_address: 'عنوان المحفظة',
    submit: 'إرسال',
    minimum: 'الحد الأدنى',
    available: 'المتاح',
    history: 'السجل',
    pending: 'قيد الانتظار',
    completed: 'مكتمل',
    rejected: 'مرفوض',
    checking_requirements: 'جارٍ التحقق من المتطلبات...',
    pending_withdrawal_warning: 'لديك سحب معلّق. يرجى الانتظار حتى تتم معالجته.',
    select_withdrawal_package: 'اختر مبلغ السحب',
    full_balance: 'الرصيد الكامل',
    you_will_receive: 'ستستلم',
    withdrawal_method: 'طريقة السحب',
    to_withdraw_need: 'للسحب تحتاج إلى:',
    wallet_activity: 'نشاط المحفظة',
    no_transactions_yet: 'لا توجد معاملات بعد',
    withdrawal_history_here: 'سيظهر سجل السحب هنا',
    connect: 'ربط',
    fee_label: 'رسوم',
    select_package: 'اختر الحزمة',
    insufficient_balance: 'رصيد غير كافٍ',
    requirements_not_met: 'المتطلبات غير مستوفاة',
    withdrawal_request_sent: 'تم إرسال طلب السحب.',
    friends: 'أصدقاء',
    friend: 'صديق',
    ads_count: 'إعلانات',
    ad_count: 'إعلان',
    ads_watched_progress: 'إعلانات شوهدت',
    more_ads_to_watch: 'متبقية',
    full_balance_lower: 'الرصيد الكامل',
    via: 'عبر',

    // ── Leaderboard ───────────────────────────────────────────
    this_week: '⭐ هذا الأسبوع',
    last_week: '🗓 الأسبوع الماضي',
    contest_ends_in: 'ينتهي المسابقة خلال',
    last_week_final: '🏁 النتائج النهائية للأسبوع الماضي',
    weekly_prize_pool: 'مجموع جوائز الأسبوع',
    last_week_prize: 'جائزة الأسبوع الماضي',
    top_10_winners: 'أفضل 10 فائزين',
    earn_stars_by: 'اكسب نجوماً بمشاهدة الإعلانات',
    no_data_last_week: 'لا توجد بيانات للأسبوع الماضي',
    no_participants_yet: 'لا يوجد مشاركون بعد',
    last_week_no_data: 'لم تكن هناك بيانات مسابقة الأسبوع الماضي.',
    watch_to_top_spot: 'شاهد الإعلانات لكسب النجوم والتصدر!',
    top_10_players: 'أفضل 10 لاعبين',
    you_label: 'أنت',
    your_rank: 'ترتيبك',
    keep_watching_climb: 'استمر في المشاهدة للتصعيد!',
    this_week_label: 'هذا الأسبوع',
    not_ranked_yet: 'غير مصنّف هذا الأسبوع بعد',
    watch_to_enter: 'شاهد الإعلانات لكسب النجوم والدخول في المسابقة',
    you_are_winning: 'أنت تفوز بـ',

    // ── Missions ──────────────────────────────────────────────
    missions: 'المهام',
    mission_title: 'المهام',
    complete_tasks_earn: 'أكمل المهام واكسب مكافآت POW',
    promo_code_label: 'الرمز الترويجي',
    earn_with_ads: 'اكسب مع الإعلانات',
    all_tasks_label: 'جميع المهام',
    all_tab: 'الكل',
    daily_tab: 'يومي',
    partner_tab: 'الشركاء',
    no_tasks_available: 'لا توجد مهام متاحة الآن',
    come_back_tomorrow: 'عُد غداً',
    no_ad_available: 'لا يوجد إعلان متاح الآن، حاول لاحقاً',
    watch_full_ad: 'يرجى مشاهدة الإعلان كاملاً للكسب',
    something_went_wrong: 'حدث خطأ ما',
    coming_soon_label: 'قريباً',
    i_want_task_here: 'أريد مهمتي هنا',
    create_your_own_task: 'أنشئ مهمتك الخاصة',
    done_label: 'تم',
    watch_label: 'شاهد',
    channel_label: 'قناة',
    bot_website_label: 'بوت / موقع',
    partner_label: 'شريك',
    claim_label: 'استلام',
    loading_ellipsis: 'جارٍ التحميل…',
    share_with_friends: 'مشاركة مع الأصدقاء',
    daily_checkin: 'تسجيل الدخول اليومي',
    check_for_updates: 'التحقق من التحديثات',
    reward: 'المكافأة',
    go: 'اذهب',
    share: 'مشاركة',
    daily_limit_short: 'تم الوصول للحد اليومي',
    per_day: '/يوم',

    // ── Ban Screen ────────────────────────────────────────────
    account_banned_msg: 'تم حظر حسابك بسبب نشاط مشبوه بحسابات متعددة',
    ban_details: 'التفاصيل:',
    all_features_disabled: 'جميع الميزات معطّلة. إذا كنت تعتقد أن هذا خطأ، يرجى التواصل مع',
    support_team: 'فريق الدعم',
    admin_self_unban: 'إلغاء الحظر (مدير)',
    unbanned_successfully: 'تم إلغاء الحظر! جارٍ إعادة التحميل...',

    // ── Country Blocked ───────────────────────────────────────
    not_available: 'غير متاح',
    not_available_country: 'هذا التطبيق غير متاح في بلدك.',

    // ── Join popup ────────────────────────────────────────────
    join_required: '🔒 الانضمام مطلوب',
    join_required_desc: 'للاستمرار في استخدام PaidAdz، يجب عليك الانضمام إلى قناتنا الرسمية ومجموعة المجتمع.',
    join_channel: '📢 انضم إلى القناة',
    join_group: '💬 انضم إلى المجموعة',
    verify_membership: '✅ تحقق من العضوية',
    not_member_yet: 'يرجى الانضمام إلى القناة والمجموعة أولاً، ثم اضغط تحقق.',

    // ── General ───────────────────────────────────────────────
    loading: 'جارٍ التحميل...',
    error: 'خطأ',
    retry: 'إعادة المحاولة',
    save: 'حفظ',
    cancel: 'إلغاء',
    confirm: 'تأكيد',
    success: 'نجاح',
    failed: 'فشل',
    processing: 'جارٍ المعالجة...',
    select_language: 'اختر اللغة',
    language_changed: 'تم تغيير اللغة!',
  },
};

export const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const VALID_LANGS: Language[] = ['en', 'ru', 'ar'];

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('app_language');
    return (VALID_LANGS.includes(saved as Language) ? saved as Language : 'en');
  });

  const isRTL = language === 'ar';

  // On mount: if localStorage was cleared (e.g. Telegram WebApp reset),
  // restore language from the server's stored preference.
  useEffect(() => {
    const saved = localStorage.getItem('app_language');
    if (!saved) {
      fetch('/api/auth/user')
        .then(r => r.ok ? r.json() : null)
        .then(user => {
          const lang = user?.language as Language | undefined;
          if (lang && VALID_LANGS.includes(lang)) {
            setLanguageState(lang);
            localStorage.setItem('app_language', lang);
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', language);
    document.body.style.direction = isRTL ? 'rtl' : 'ltr';
  }, [language, isRTL]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app_language', lang);
    try {
      fetch('/api/user/language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang }),
      }).catch(() => {});
    } catch {}
  };

  const t = (key: string): string => {
    return translations[language]?.[key] || translations['en']?.[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
};

// Standalone translation helper (for components outside LanguageProvider)
export function getTranslation(key: string): string {
  const lang = (localStorage.getItem('app_language') as Language) || 'en';
  return translations[lang]?.[key] || translations['en']?.[key] || key;
}
