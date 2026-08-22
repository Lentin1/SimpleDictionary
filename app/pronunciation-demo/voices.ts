export type VoiceLanguage =
  | "zh-CN"
  | "zh-YUE"
  | "en"
  | "ja"
  | "ko"
  | "es"
  | "pt"
  | "fr"
  | "id"
  | "de"
  | "ru";

export type VoiceOption = {
  id: string;
  name: string;
  language: VoiceLanguage;
};

type VoiceGroup = {
  language: VoiceLanguage;
  voices: Array<[string, string]>;
};

const GROUPS: VoiceGroup[] = [
  {
    language: "zh-CN",
    voices: [
      ["male-qn-qingse", "青涩青年音色"], ["male-qn-jingying", "精英青年音色"], ["male-qn-badao", "霸道青年音色"], ["male-qn-daxuesheng", "青年大学生音色"],
      ["female-shaonv", "少女音色"], ["female-yujie", "御姐音色"], ["female-chengshu", "成熟女性音色"], ["female-tianmei", "甜美女性音色"],
      ["male-qn-qingse-jingpin", "青涩青年音色-beta"], ["male-qn-jingying-jingpin", "精英青年音色-beta"], ["male-qn-badao-jingpin", "霸道青年音色-beta"], ["male-qn-daxuesheng-jingpin", "青年大学生音色-beta"],
      ["female-shaonv-jingpin", "少女音色-beta"], ["female-yujie-jingpin", "御姐音色-beta"], ["female-chengshu-jingpin", "成熟女性音色-beta"], ["female-tianmei-jingpin", "甜美女性音色-beta"],
      ["clever_boy", "聪明男童"], ["cute_boy", "可爱男童"], ["lovely_girl", "萌萌女童"], ["cartoon_pig", "卡通猪小琪"], ["bingjiao_didi", "病娇弟弟"], ["junlang_nanyou", "俊朗男友"],
      ["chunzhen_xuedi", "纯真学弟"], ["lengdan_xiongzhang", "冷淡学长"], ["badao_shaoye", "霸道少爷"], ["tianxin_xiaoling", "甜心小玲"], ["qiaopi_mengmei", "俏皮萌妹"], ["wumei_yujie", "妩媚御姐"], ["diadia_xuemei", "嗲嗲学妹"], ["danya_xuejie", "淡雅学姐"],
      ["Chinese (Mandarin)_Reliable_Executive", "沉稳高管"], ["Chinese (Mandarin)_News_Anchor", "新闻女声"], ["Chinese (Mandarin)_Mature_Woman", "傲娇御姐"], ["Chinese (Mandarin)_Unrestrained_Young_Man", "不羁青年"], ["Arrogant_Miss", "嚣张小姐"], ["Robot_Armor", "机械战甲"], ["Chinese (Mandarin)_Kind-hearted_Antie", "热心大婶"], ["Chinese (Mandarin)_HK_Flight_Attendant", "港普空姐"],
      ["Chinese (Mandarin)_Humorous_Elder", "搞笑大爷"], ["Chinese (Mandarin)_Gentleman", "温润男声"], ["Chinese (Mandarin)_Warm_Bestie", "温暖闺蜜"], ["Chinese (Mandarin)_Male_Announcer", "播报男声"], ["Chinese (Mandarin)_Sweet_Lady", "甜美女声"], ["Chinese (Mandarin)_Southern_Young_Man", "南方小哥"], ["Chinese (Mandarin)_Wise_Women", "阅历姐姐"], ["Chinese (Mandarin)_Gentle_Youth", "温润青年"],
      ["Chinese (Mandarin)_Warm_Girl", "温暖少女"], ["Chinese (Mandarin)_Kind-hearted_Elder", "花甲奶奶"], ["Chinese (Mandarin)_Cute_Spirit", "憨憨萌兽"], ["Chinese (Mandarin)_Radio_Host", "电台男主播"], ["Chinese (Mandarin)_Lyrical_Voice", "抒情男声"], ["Chinese (Mandarin)_Straightforward_Boy", "率真弟弟"], ["Chinese (Mandarin)_Sincere_Adult", "真诚青年"], ["Chinese (Mandarin)_Gentle_Senior", "温柔学姐"], ["Chinese (Mandarin)_Stubborn_Friend", "嘴硬竹马"], ["Chinese (Mandarin)_Crisp_Girl", "清脆少女"], ["Chinese (Mandarin)_Pure-hearted_Boy", "清澈邻家弟弟"], ["Chinese (Mandarin)_Soft_Girl", "柔和少女"],
    ],
  },
  {
    language: "zh-YUE",
    voices: [["Cantonese_ProfessionalHost（F)", "专业女主持"], ["Cantonese_GentleLady", "温柔女声"], ["Cantonese_ProfessionalHost（M)", "专业男主持"], ["Cantonese_PlayfulMan", "活泼男声"], ["Cantonese_CuteGirl", "可爱女孩"], ["Cantonese_KindWoman", "善良女声"]],
  },
  {
    language: "en",
    voices: [
      ["Santa_Claus", "Santa Claus"], ["Grinch", "Grinch"], ["Rudolph", "Rudolph"], ["Arnold", "Arnold"], ["Charming_Santa", "Charming Santa"], ["Charming_Lady", "Charming Lady"], ["Sweet_Girl", "Sweet Girl"], ["Cute_Elf", "Cute Elf"], ["Attractive_Girl", "Attractive Girl"], ["Serene_Woman", "Serene Woman"],
      ["English_Trustworthy_Man", "Trustworthy Man"], ["English_Graceful_Lady", "Graceful Lady"], ["English_Aussie_Bloke", "Aussie Bloke"], ["English_Whispering_girl", "Whispering Girl"], ["English_Diligent_Man", "Diligent Man"], ["English_Gentle-voiced_man", "Gentle-voiced Man"],
    ],
  },
  {
    language: "ja",
    voices: [["Japanese_IntellectualSenior", "Intellectual Senior"], ["Japanese_DecisivePrincess", "Decisive Princess"], ["Japanese_LoyalKnight", "Loyal Knight"], ["Japanese_DominantMan", "Dominant Man"], ["Japanese_SeriousCommander", "Serious Commander"], ["Japanese_ColdQueen", "Cold Queen"], ["Japanese_DependableWoman", "Dependable Woman"], ["Japanese_GentleButler", "Gentle Butler"], ["Japanese_KindLady", "Kind Lady"], ["Japanese_CalmLady", "Calm Lady"], ["Japanese_OptimisticYouth", "Optimistic Youth"], ["Japanese_GenerousIzakayaOwner", "Generous Izakaya Owner"], ["Japanese_SportyStudent", "Sporty Student"], ["Japanese_InnocentBoy", "Innocent Boy"], ["Japanese_GracefulMaiden", "Graceful Maiden"]],
  },
  {
    language: "ko",
    voices: [["Korean_SweetGirl", "Sweet Girl"], ["Korean_CheerfulBoyfriend", "Cheerful Boyfriend"], ["Korean_EnchantingSister", "Enchanting Sister"], ["Korean_ShyGirl", "Shy Girl"], ["Korean_ReliableSister", "Reliable Sister"], ["Korean_StrictBoss", "Strict Boss"], ["Korean_SassyGirl", "Sassy Girl"], ["Korean_ChildhoodFriendGirl", "Childhood Friend Girl"], ["Korean_PlayboyCharmer", "Playboy Charmer"], ["Korean_ElegantPrincess", "Elegant Princess"], ["Korean_BraveFemaleWarrior", "Brave Female Warrior"], ["Korean_BraveYouth", "Brave Youth"], ["Korean_CalmLady", "Calm Lady"], ["Korean_EnthusiasticTeen", "Enthusiastic Teen"], ["Korean_SoothingLady", "Soothing Lady"], ["Korean_IntellectualSenior", "Intellectual Senior"], ["Korean_LonelyWarrior", "Lonely Warrior"], ["Korean_MatureLady", "Mature Lady"], ["Korean_InnocentBoy", "Innocent Boy"], ["Korean_CharmingSister", "Charming Sister"], ["Korean_AthleticStudent", "Athletic Student"], ["Korean_BraveAdventurer", "Brave Adventurer"], ["Korean_CalmGentleman", "Calm Gentleman"], ["Korean_WiseElf", "Wise Elf"], ["Korean_CheerfulCoolJunior", "Cheerful Cool Junior"], ["Korean_DecisiveQueen", "Decisive Queen"], ["Korean_ColdYoungMan", "Cold Young Man"], ["Korean_MysteriousGirl", "Mysterious Girl"], ["Korean_QuirkyGirl", "Quirky Girl"], ["Korean_ConsiderateSenior", "Considerate Senior"], ["Korean_CheerfulLittleSister", "Cheerful Little Sister"], ["Korean_DominantMan", "Dominant Man"], ["Korean_AirheadedGirl", "Airheaded Girl"], ["Korean_ReliableYouth", "Reliable Youth"], ["Korean_FriendlyBigSister", "Friendly Big Sister"], ["Korean_GentleBoss", "Gentle Boss"], ["Korean_ColdGirl", "Cold Girl"], ["Korean_HaughtyLady", "Haughty Lady"], ["Korean_CharmingElderSister", "Charming Elder Sister"], ["Korean_IntellectualMan", "Intellectual Man"], ["Korean_CaringWoman", "Caring Woman"], ["Korean_WiseTeacher", "Wise Teacher"], ["Korean_ConfidentBoss", "Confident Boss"], ["Korean_AthleticGirl", "Athletic Girl"], ["Korean_PossessiveMan", "Possessive Man"], ["Korean_GentleWoman", "Gentle Woman"], ["Korean_CockyGuy", "Cocky Guy"], ["Korean_ThoughtfulWoman", "Thoughtful Woman"], ["Korean_OptimisticYouth", "Optimistic Youth"]],
  },
  {
    language: "es",
    voices: [["Spanish_SereneWoman", "Serene Woman"], ["Spanish_MaturePartner", "Mature Partner"], ["Spanish_CaptivatingStoryteller", "Captivating Storyteller"], ["Spanish_Narrator", "Narrator"], ["Spanish_WiseScholar", "Wise Scholar"], ["Spanish_Kind-heartedGirl", "Kind-hearted Girl"], ["Spanish_DeterminedManager", "Determined Manager"], ["Spanish_BossyLeader", "Bossy Leader"], ["Spanish_ReservedYoungMan", "Reserved Young Man"], ["Spanish_ConfidentWoman", "Confident Woman"], ["Spanish_ThoughtfulMan", "Thoughtful Man"], ["Spanish_Strong-WilledBoy", "Strong-willed Boy"], ["Spanish_SophisticatedLady", "Sophisticated Lady"], ["Spanish_RationalMan", "Rational Man"], ["Spanish_AnimeCharacter", "Anime Character"], ["Spanish_Deep-tonedMan", "Deep-toned Man"], ["Spanish_Fussyhostess", "Fussy Hostess"], ["Spanish_SincereTeen", "Sincere Teen"], ["Spanish_FrankLady", "Frank Lady"], ["Spanish_Comedian", "Comedian"], ["Spanish_Debator", "Debator"], ["Spanish_ToughBoss", "Tough Boss"], ["Spanish_Wiselady", "Wise Lady"], ["Spanish_Steadymentor", "Steady Mentor"], ["Spanish_Jovialman", "Jovial Man"], ["Spanish_SantaClaus", "Santa Claus"], ["Spanish_Rudolph", "Rudolph"], ["Spanish_Intonategirl", "Intonate Girl"], ["Spanish_Arnold", "Arnold"], ["Spanish_Ghost", "Ghost"], ["Spanish_HumorousElder", "Humorous Elder"], ["Spanish_EnergeticBoy", "Energetic Boy"], ["Spanish_WhimsicalGirl", "Whimsical Girl"], ["Spanish_StrictBoss", "Strict Boss"], ["Spanish_ReliableMan", "Reliable Man"], ["Spanish_SereneElder", "Serene Elder"], ["Spanish_AngryMan", "Angry Man"], ["Spanish_AssertiveQueen", "Assertive Queen"], ["Spanish_CaringGirlfriend", "Caring Girlfriend"], ["Spanish_PowerfulSoldier", "Powerful Soldier"], ["Spanish_PassionateWarrior", "Passionate Warrior"], ["Spanish_ChattyGirl", "Chatty Girl"], ["Spanish_RomanticHusband", "Romantic Husband"], ["Spanish_CompellingGirl", "Compelling Girl"], ["Spanish_PowerfulVeteran", "Powerful Veteran"], ["Spanish_SensibleManager", "Sensible Manager"], ["Spanish_ThoughtfulLady", "Thoughtful Lady"]],
  },
  {
    language: "pt",
    voices: [["Portuguese_SentimentalLady", "Sentimental Lady"], ["Portuguese_BossyLeader", "Bossy Leader"], ["Portuguese_Wiselady", "Wise Lady"], ["Portuguese_Strong-WilledBoy", "Strong-willed Boy"], ["Portuguese_Deep-VoicedGentleman", "Deep-voiced Gentleman"], ["Portuguese_UpsetGirl", "Upset Girl"], ["Portuguese_PassionateWarrior", "Passionate Warrior"], ["Portuguese_AnimeCharacter", "Anime Character"], ["Portuguese_ConfidentWoman", "Confident Woman"], ["Portuguese_AngryMan", "Angry Man"], ["Portuguese_CaptivatingStoryteller", "Captivating Storyteller"], ["Portuguese_Godfather", "Godfather"], ["Portuguese_ReservedYoungMan", "Reserved Young Man"], ["Portuguese_SmartYoungGirl", "Smart Young Girl"], ["Portuguese_Kind-heartedGirl", "Kind-hearted Girl"], ["Portuguese_Pompouslady", "Pompous Lady"], ["Portuguese_Grinch", "Grinch"], ["Portuguese_Debator", "Debator"], ["Portuguese_SweetGirl", "Sweet Girl"], ["Portuguese_AttractiveGirl", "Attractive Girl"], ["Portuguese_ThoughtfulMan", "Thoughtful Man"], ["Portuguese_PlayfulGirl", "Playful Girl"], ["Portuguese_GorgeousLady", "Gorgeous Lady"], ["Portuguese_LovelyLady", "Lovely Lady"], ["Portuguese_SereneWoman", "Serene Woman"], ["Portuguese_SadTeen", "Sad Teen"], ["Portuguese_MaturePartner", "Mature Partner"], ["Portuguese_Comedian", "Comedian"], ["Portuguese_NaughtySchoolgirl", "Naughty Schoolgirl"], ["Portuguese_Narrator", "Narrator"], ["Portuguese_ToughBoss", "Tough Boss"], ["Portuguese_Fussyhostess", "Fussy Hostess"], ["Portuguese_Dramatist", "Dramatist"], ["Portuguese_Steadymentor", "Steady Mentor"], ["Portuguese_Jovialman", "Jovial Man"], ["Portuguese_CharmingQueen", "Charming Queen"], ["Portuguese_SantaClaus", "Santa Claus"], ["Portuguese_Rudolph", "Rudolph"], ["Portuguese_Arnold", "Arnold"], ["Portuguese_CharmingSanta", "Charming Santa"], ["Portuguese_CharmingLady", "Charming Lady"], ["Portuguese_Ghost", "Ghost"], ["Portuguese_HumorousElder", "Humorous Elder"], ["Portuguese_CalmLeader", "Calm Leader"], ["Portuguese_GentleTeacher", "Gentle Teacher"], ["Portuguese_EnergeticBoy", "Energetic Boy"], ["Portuguese_ReliableMan", "Reliable Man"], ["Portuguese_SereneElder", "Serene Elder"], ["Portuguese_GrimReaper", "Grim Reaper"], ["Portuguese_AssertiveQueen", "Assertive Queen"], ["Portuguese_WhimsicalGirl", "Whimsical Girl"], ["Portuguese_StressedLady", "Stressed Lady"], ["Portuguese_FriendlyNeighbor", "Friendly Neighbor"], ["Portuguese_CaringGirlfriend", "Caring Girlfriend"], ["Portuguese_PowerfulSoldier", "Powerful Soldier"], ["Portuguese_FascinatingBoy", "Fascinating Boy"], ["Portuguese_RomanticHusband", "Romantic Husband"], ["Portuguese_StrictBoss", "Strict Boss"], ["Portuguese_InspiringLady", "Inspiring Lady"], ["Portuguese_PlayfulSpirit", "Playful Spirit"], ["Portuguese_ElegantGirl", "Elegant Girl"], ["Portuguese_CompellingGirl", "Compelling Girl"], ["Portuguese_PowerfulVeteran", "Powerful Veteran"], ["Portuguese_SensibleManager", "Sensible Manager"], ["Portuguese_ThoughtfulLady", "Thoughtful Lady"], ["Portuguese_TheatricalActor", "Theatrical Actor"], ["Portuguese_FragileBoy", "Fragile Boy"], ["Portuguese_ChattyGirl", "Chatty Girl"], ["Portuguese_Conscientiousinstructor", "Conscientious Instructor"], ["Portuguese_RationalMan", "Rational Man"], ["Portuguese_WiseScholar", "Wise Scholar"], ["Portuguese_FrankLady", "Frank Lady"], ["Portuguese_DeterminedManager", "Determined Manager"]],
  },
  {
    language: "fr",
    voices: [["French_Male_Speech_New", "Level-Headed Man"], ["French_Female_News Anchor", "Patient Female Presenter"], ["French_CasualMan", "Casual Man"], ["French_MovieLeadFemale", "Movie Lead Female"], ["French_FemaleAnchor", "Female Anchor"], ["French_MaleNarrator", "Male Narrator"]],
  },
  {
    language: "id",
    voices: [["Indonesian_SweetGirl", "Sweet Girl"], ["Indonesian_ReservedYoungMan", "Reserved Young Man"], ["Indonesian_CharmingGirl", "Charming Girl"], ["Indonesian_CalmWoman", "Calm Woman"], ["Indonesian_ConfidentWoman", "Confident Woman"], ["Indonesian_CaringMan", "Caring Man"], ["Indonesian_BossyLeader", "Bossy Leader"], ["Indonesian_DeterminedBoy", "Determined Boy"], ["Indonesian_GentleGirl", "Gentle Girl"]],
  },
  {
    language: "de",
    voices: [["German_FriendlyMan", "Friendly Man"], ["German_SweetLady", "Sweet Lady"], ["German_PlayfulMan", "Playful Man"]],
  },
  {
    language: "ru",
    voices: [["Russian_HandsomeChildhoodFriend", "Handsome Childhood Friend"], ["Russian_BrightHeroine", "Bright Queen"], ["Russian_AmbitiousWoman", "Ambitious Woman"], ["Russian_ReliableMan", "Reliable Man"], ["Russian_CrazyQueen", "Crazy Girl"]],
  },
];

export const MINIMAX_VOICES: VoiceOption[] = GROUPS.flatMap(({ language, voices }) => voices.map(([id, name]) => ({ id, name, language })));

export const VOICE_LANGUAGES: Array<{ id: VoiceLanguage; label: string; boost: string }> = [
  { id: "zh-CN", label: "中文（普通话）", boost: "Chinese" },
  { id: "zh-YUE", label: "中文（粤语）", boost: "Cantonese" },
  { id: "en", label: "英语", boost: "English" },
  { id: "ja", label: "日语", boost: "Japanese" },
  { id: "ko", label: "韩语", boost: "Korean" },
  { id: "es", label: "西班牙语", boost: "Spanish" },
  { id: "pt", label: "葡萄牙语", boost: "Portuguese" },
  { id: "fr", label: "法语", boost: "French" },
  { id: "id", label: "印尼语", boost: "Indonesian" },
  { id: "de", label: "德语", boost: "German" },
  { id: "ru", label: "俄语", boost: "Russian" },
];
