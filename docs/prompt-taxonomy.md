# 提示词分类体系（18 轴）

> 本文件由 `scripts/gen-prompt-taxonomy-doc.mjs` 从 `public/presets/prompt-taxonomy/v1.json` 生成，请勿手改。

- 词表版本：**2026-11-23.2**
- 轴数：**18**
- 受控值总数：**430**
- 单轴推导上限：默认 6，题材 8

## 怎么用

- 筛选接口：`GET /api/prompt-cases?facet=axis:value`，可重复；同轴 OR、跨轴 AND。
- 计数接口：`GET /api/prompt-cases/facets`，算某轴时排除该轴自身条件。
- 人工修正：`PATCH /api/prompt-cases/:id/facets`，`{ add, remove, restore }` 都用 `axis:value`。
- 回填旧案例：`node scripts/backfill-prompt-facets.mjs --dry-run` 预演，去掉 `--dry-run` 写入；`--only-stale` 只补版本落后的案例。
- 新增来源分类映射：在 JSON 的 `sourceMappings.<来源>` 里加一项，值为 `axis:value` 数组，然后重跑本脚本。

## 轴与值

### 1. 题材类型（`genre`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `action` | 动作 | action | action film | 动作片、打斗片 |  |
| `adventure` | 冒险 | adventure | adventure | 探险 |  |
| `comedy` | 喜剧 | comedy | comedy | 搞笑、幽默 |  |
| `crime` | 犯罪 | crime | crime film | 警匪、刑侦 |  |
| `gangster` | 黑帮 | gangster | gangster film | 黑社会 |  |
| `drama` | 剧情 | drama | drama | 正剧 |  |
| `epic-historical` | 史诗历史 | epic historical | epic historical film | 历史片、古装 |  |
| `horror` | 恐怖 | horror | horror film | 惊悚恐怖、鬼片 |  |
| `musical` | 歌舞 | musical | musical | 音乐剧 |  |
| `sci-fi` | 科幻 | science fiction | science fiction | 科玄、硬科幻 |  |
| `war` | 战争 | war | war film | 战争片 |  |
| `western` | 西部片 | western | western | 西部 |  |
| `fantasy` | 奇幻 | fantasy | fantasy | 魔幻 |  |
| `romance` | 爱情 | romance | romance | 言情 |  |
| `thriller` | 惊悚 | thriller | thriller | 悬疑惊悚 |  |
| `mystery` | 悬疑 | mystery | mystery | 推理、探案 |  |
| `film-noir` | 黑色电影 | film noir | film noir | 黑色片 |  |
| `neo-noir` | 新黑色电影 | neo-noir | neo-noir | 新黑色 |  |
| `disaster` | 灾难 | disaster | disaster film | 灾难题材 |  |
| `sports` | 体育 | sports | sports film | 运动 |  |
| `superhero` | 超级英雄 | superhero | superhero | 超英 |  |
| `animation` | 动画 | animation | animation | 卡通 |  |
| `documentary` | 纪录 | documentary | documentary | 纪录片、纪实片 |  |
| `mockumentary` | 伪纪录 | mockumentary | mockumentary | 伪纪录片 |  |
| `biopic` | 传记 | biopic | biopic | 人物传记 |  |
| `coming-of-age` | 青春成长 | coming of age | coming of age | 青春片、成长 |  |
| `road-movie` | 公路片 | road movie | road movie | 公路 |  |
| `heist` | 劫案 | heist | heist film | 盗窃、抢案 |  |
| `martial-arts` | 武侠功夫 | martial arts | martial arts | 武侠、功夫、武打 |  |
| `cyberpunk` | 赛博朋克 | cyberpunk | cyberpunk | 赛博 |  |
| `post-apocalyptic` | 末日 | post-apocalyptic | post-apocalyptic | 废土、末世 |  |
| `culinary` | 美食 | culinary | food film | 料理、美食片 |  |
| `music-video` | 音乐录影 | music video | music video | MV、mv |  |
| `character-piece` | 人物特写 | character piece | character piece | 角色片 |  |
| `vlog` | Vlog 日常 | vlog | vlog | 日常记录、vlog 风格 |  |
| `commercial` | 广告 | commercial | commercial | TVC、宣传片 |  |
| `travel` | 旅行 | travel | travel film | 旅途、旅行片 |  |
| `product` | 产品 | product | product film | 商品、产品片 |  |
| `architecture` | 建筑空间 | architecture | architecture film | 建筑 |  |
| `animal` | 动物 | animal | animal film | 萌宠、动物片 |  |
| `channel-intro` | 频道片头 | channel intro | channel intro | 片头、开场动画 |  |
| `tutorial` | 教程 | tutorial | tutorial | 教学、讲解 |  |
| `nature` | 自然 | nature | nature film | 自然风光、野生 |  |
| `experimental` | 实验影像 | experimental | experimental film | 实验片、前卫 |  |
| `surreal` | 超现实 | surreal | surreal | 超现实主义 |  |
| `short-film` | 短片 | short film | short film | 微电影 |  |

### 2. 叙事结构（`narrative`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `linear` | 线性叙事 | linear | linear narrative | 顺叙 |  |
| `non-linear` | 非线性叙事 | non-linear | non-linear narrative | 非线性 |  |
| `flashback` | 闪回 | flashback | flashback | 回忆 |  |
| `flash-forward` | 闪前 | flash forward | flash forward | 预叙 |  |
| `in-medias-res` | 中途开场 | in medias res | in medias res | 开场即高潮 |  |
| `circular` | 环形结构 | circular | circular structure | 首尾呼应 |  |
| `episodic` | 段落式 | episodic | episodic structure | 章节式 |  |
| `three-act` | 三幕式 | three act | three-act structure | 三幕 |  |
| `hero-journey` | 英雄之旅 | hero's journey | hero's journey | 英雄历程 |  |
| `twist-ending` | 反转结局 | twist ending | twist ending | 结局反转 |  |
| `cliffhanger` | 悬念收尾 | cliffhanger | cliffhanger | 悬念结尾 |  |
| `montage-sequence` | 蒙太奇段 | montage sequence | montage sequence | 蒙太奇 |  |
| `single-take` | 单镜头叙事 | single take | single take | 一镜到底 |  |
| `pov-narrative` | 主观叙事 | POV narrative | POV narrative | 第一人称 |  |
| `ensemble` | 群像叙事 | ensemble | ensemble narrative | 多线并进 |  |
| `frame-narrative` | 框架叙事 | frame narrative | frame narrative | 故事中的故事 |  |
| `dream-logic` | 梦境逻辑 | dream logic | dream logic | 超逻辑 |  |
| `mockumentary-narrative` | 伪纪录叙事 | mockumentary narrative | mockumentary narrative | 伪纪录体 |  |
| `loop` | 时间循环 | time loop | time loop | 循环结构 |  |

### 3. 情绪基调（`tone`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `tense` | 紧张 | tense | tense | 绷紧 |  |
| `suspenseful` | 悬疑 | suspenseful | suspenseful | 悬念 |  |
| `melancholic` | 忧郁 | melancholic | melancholic | 伤感、哀伤 |  |
| `joyful` | 欢快 | joyful | joyful | 愉快、轻快 |  |
| `romantic` | 浪漫 | romantic | romantic | 唯美浪漫 |  |
| `epic` | 史诗感 | epic | epic scale | 宏大 |  |
| `ominous` | 不祥 | ominous | ominous | 压抑不祥 |  |
| `dreamy` | 梦幻 | dreamy | dreamy | 朦胧 |  |
| `gritty` | 粗粝 | gritty | gritty | 粗粝写实 |  |
| `whimsical` | 怪趣 | whimsical | whimsical | 奇趣 |  |
| `nostalgic` | 怀旧 | nostalgic | nostalgic | 复古怀旧 |  |
| `cold` | 冷峻 | cold | cold and detached | 冷酷 |  |
| `warm-hearted` | 温情 | warm-hearted | warm-hearted | 温暖 |  |
| `absurd` | 荒诞 | absurd | absurd | 黑色荒诞 |  |
| `satirical` | 讽刺 | satirical | satirical | 调侃 |  |
| `tragic` | 悲剧 | tragic | tragic | 悲情 |  |
| `hopeful` | 希望 | hopeful | hopeful | 昂扬 |  |
| `oppressive` | 压抑 | oppressive | oppressive | 窒息感 |  |
| `serene` | 宁静 | serene | serene | 静谧 |  |
| `chaotic` | 混乱 | chaotic | chaotic | 失序 |  |
| `eerie` | 诡异 | eerie | eerie | 怪诞 |  |
| `playful` | 俏皮 | playful | playful | 调皮 |  |
| `solemn` | 庄重 | solemn | solemn | 肃穆 |  |
| `intimate` | 亲密 | intimate | intimate | 私密 |  |
| `alienated` | 疏离 | alienated | alienated | 孤独疏离 |  |

### 4. 时代地域（`period`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `ancient-china` | 古代中国 | ancient China | ancient China | 古装中国、古风 |  |
| `republican-china` | 民国 | republican era China | republican era China | 民国时期 |  |
| `china-1980s` | 八十年代中国 | 1980s China | 1980s China | 八十年代 |  |
| `contemporary` | 当代 | contemporary | contemporary setting | 现代、当下 |  |
| `near-future` | 近未来 | near future | near future | 近未来都市 |  |
| `far-future` | 远未来 | far future | far future | 未来世界 |  |
| `medieval` | 中世纪 | medieval | medieval | 中古 |  |
| `victorian` | 维多利亚 | victorian | victorian era | 维多利亚时代 |  |
| `renaissance` | 文艺复兴 | renaissance | renaissance | 文艺复兴时期 |  |
| `wild-west` | 西部拓荒 | wild west | wild west | 拓荒时代 |  |
| `world-war-ii` | 二战 | world war II | world war II | 二次大战 |  |
| `cold-war` | 冷战 | cold war | cold war | 冷战时期 |  |
| `post-war` | 战后 | post-war | post-war | 战后年代 |  |
| `cyber-future` | 赛博未来 | cyber future | cyberpunk future | 赛博都市 |  |
| `dystopian` | 反乌托邦 | dystopian | dystopian | 反乌托邦未来 |  |
| `space-age` | 太空时代 | space age | space age | 星际时代 |  |
| `feudal-japan` | 日本战国 | feudal Japan | feudal Japan | 战国日本 |  |
| `edo-japan` | 江户 | edo period | edo period Japan | 江户时代 |  |
| `noir-1940s` | 四十年代黑色 | 1940s noir | 1940s film noir | 四十年代 |  |
| `seventies` | 七十年代 | 1970s | 1970s | 七十年代复古 |  |
| `nineties` | 九十年代 | 1990s | 1990s | 九十年代复古 |  |
| `y2k` | 千禧年 | Y2K | Y2K aesthetic | 千禧风 |  |
| `future-2100` | 二十二世纪 | 22nd century | 22nd century | 未来世纪 |  |
| `mythic` | 神话时代 | mythic age | mythic age | 上古神话 |  |
| `timeless` | 无年代 | timeless | timeless setting | 超时代 |  |
| `near-east` | 中东 | middle east | middle eastern setting | 中东地域 |  |

### 5. 场景环境（`environment`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `alley` | 巷口 | alley | narrow alley | 小巷、胡同 |  |
| `street` | 街道 | street | city street | 马路、街头 |  |
| `rooftop` | 天台 | rooftop | rooftop | 屋顶 |  |
| `interior-room` | 房间 | interior room | interior room | 卧室、室内 |  |
| `kitchen` | 厨房 | kitchen | kitchen | 灶间 |  |
| `bathroom` | 浴室 | bathroom | bathroom | 卫生间 |  |
| `office` | 办公室 | office | office | 写字楼 |  |
| `hospital` | 医院 | hospital | hospital | 病房 |  |
| `school` | 校园 | school | school campus | 教室 |  |
| `temple` | 寺庙 | temple | temple | 道观、寺院 |  |
| `palace` | 宫殿 | palace | palace | 宫城 |  |
| `forest` | 森林 | forest | forest | 树林、竹林 |  |
| `desert` | 沙漠 | desert | desert | 荒漠 |  |
| `ocean` | 海洋 | ocean | open ocean | 大海 |  |
| `beach` | 海滩 | beach | beach | 沙滩 |  |
| `mountain` | 山脉 | mountain | mountain range | 山野 |  |
| `snowfield` | 雪原 | snowfield | snowfield | 雪地 |  |
| `swamp` | 沼泽 | swamp | swamp | 湿地 |  |
| `cave` | 洞穴 | cave | cave | 山洞 |  |
| `factory` | 工厂 | factory | factory | 车间 |  |
| `warehouse` | 仓库 | warehouse | warehouse | 货仓 |  |
| `subway` | 地铁 | subway | subway station | 地铁站 |  |
| `train` | 列车 | train | train interior | 火车 |  |
| `car-interior` | 车内 | car interior | car interior | 车厢内 |  |
| `bar` | 酒吧 | bar | bar interior | 酒馆 |  |
| `restaurant` | 餐厅 | restaurant | restaurant | 饭馆 |  |
| `stadium` | 体育场 | stadium | stadium | 球场 |  |
| `studio` | 影棚 | studio | photo studio | 摄影棚 |  |
| `stage` | 舞台 | stage | theatre stage | 剧场 |  |
| `void` | 虚空 | void | empty void | 空白空间 |  |

### 6. 主体角色（`subject`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `human` | 人物 | human | a person | 人、人物主体、人影 |  |
| `solo` | 单人 | solo figure | a lone figure | 独自一人 |  |
| `duo` | 双人 | two people | two people | 两人 |  |
| `crowd` | 群像 | crowd | a crowd | 人群 |  |
| `child` | 儿童 | child | a child | 小孩 |  |
| `elder` | 老人 | elder | an elderly person | 长者 |  |
| `animal` | 动物 | animal | an animal | 野兽、宠物 |  |
| `insect` | 昆虫 | insect | an insect | 虫子 |  |
| `vehicle` | 载具 | vehicle | a vehicle | 汽车、交通工具 |  |
| `robot` | 机器人 | robot | a robot | 机械体 |  |
| `creature` | 怪物 | creature | a creature | 异兽 |  |
| `object` | 静物 | object | a still object | 物件 |  |
| `food` | 食物 | food | food | 美食主体 |  |
| `plant` | 植物 | plant | a plant | 花草 |  |
| `landscape` | 风景 | landscape | a landscape | 自然景观 |  |
| `architecture` | 建筑 | architecture | architecture | 建筑主体 |  |
| `interior` | 室内空间 | interior | an interior space | 空间主体 |  |
| `cityscape` | 城市 | cityscape | a cityscape | 城市景观 |  |
| `product` | 产品 | product | a product | 商品主体 |  |
| `garment` | 服饰 | garment | a garment | 服装 |  |
| `hands` | 手部 | hands | hands | 双手 |  |
| `face` | 面孔 | face | a face | 脸部 |  |
| `silhouette` | 剪影人物 | silhouette figure | a silhouette figure | 剪影 |  |
| `mascot` | 吉祥物 | mascot | a mascot character | 玩偶角色 |  |

### 7. 动作表演（`action`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `walk` | 行走 | walking | walking | 走、踱步 |  |
| `run` | 奔跑 | running | running | 跑 |  |
| `fight` | 打斗 | fighting | fighting | 格斗、厮杀 |  |
| `dance` | 舞蹈 | dancing | dancing | 起舞 |  |
| `jump` | 跳跃 | jumping | jumping | 跃起 |  |
| `fall` | 坠落 | falling | falling | 跌落 |  |
| `chase` | 追逐 | chase | a chase | 追逃 |  |
| `embrace` | 拥抱 | embracing | embracing | 相拥 |  |
| `kiss` | 亲吻 | kissing | kissing | 接吻 |  |
| `eat` | 进食 | eating | eating | 吃 |  |
| `drink` | 饮用 | drinking | drinking | 喝 |  |
| `drive` | 驾驶 | driving | driving | 开车 |  |
| `fly` | 飞行 | flying | flying | 腾空 |  |
| `swim` | 游泳 | swimming | swimming | 泅水 |  |
| `climb` | 攀爬 | climbing | climbing | 攀登 |  |
| `throw` | 投掷 | throwing | throwing | 抛出 |  |
| `draw-weapon` | 拔械 | drawing a weapon | drawing a weapon | 拔刀、拔枪 |  |
| `reload` | 换弹 | reloading | reloading | 上膛 |  |
| `explosion-reaction` | 爆炸反应 | explosion reaction | reacting to an explosion | 冲击波反应 |  |
| `cry` | 哭泣 | crying | crying | 落泪 |  |
| `laugh` | 大笑 | laughing | laughing | 笑 |  |
| `sleep` | 入睡 | sleeping | sleeping | 睡着 |  |
| `wake` | 苏醒 | waking | waking up | 醒来 |  |
| `work` | 劳作 | working | working | 干事 |  |
| `craft` | 手工 | crafting | crafting with hands | 制作 |  |
| `transform` | 变身 | transforming | transforming | 变形 |  |
| `performance` | 表演 | performing | performing | 演出 |  |

### 8. 道具特效（`props-fx`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `rain` | 雨 | rain | rain | 下雨、暴雨、小雨、雨中、雨幕 |  |
| `snow` | 雪 | snow | snow | 下雪、飞雪、雪地 |  |
| `fog` | 雾 | fog | fog | 大雾、薄雾、起雾、雾气、雾中 |  |
| `smoke` | 烟 | smoke | smoke | 烟雾 |  |
| `fire` | 火 | fire | fire | 火焰、火光 |  |
| `explosion` | 爆炸 | explosion | explosion | 爆燃 |  |
| `sparks` | 火星 | sparks | sparks | 火花 |  |
| `dust` | 尘埃 | dust | dust | 尘土、浮尘 |  |
| `water-splash` | 水花 | water splash | water splash | 溅水 |  |
| `wind` | 风 | wind | wind | 大风、狂风、风中 |  |
| `lightning` | 闪电 | lightning | lightning | 雷鸣、打雷 |  |
| `blood` | 血 | blood | blood | 血迹、血泊 |  |
| `glass-shatter` | 玻璃破碎 | shattering glass | shattering glass | 碎玻璃 |  |
| `mirror` | 镜子 | mirror | a mirror | 镜面 |  |
| `weapon` | 武器 | weapon | a weapon | 兵器 |  |
| `sword` | 刀剑 | sword | a sword | 长剑、刀、刀光 |  |
| `gun` | 枪械 | gun | a gun | 手枪、步枪 |  |
| `vehicle-prop` | 交通工具 | vehicle | a vehicle | 车、车流 |  |
| `phone` | 手机 | phone | a phone | 电话 |  |
| `screen` | 屏幕 | screen | a glowing screen | 显示器 |  |
| `book` | 书 | book | a book | 书本、翻书 |  |
| `letter` | 信 | letter | a letter | 信件、信封 |  |
| `food-prop` | 食物道具 | food prop | food on a table | 餐食 |  |
| `money` | 钞票 | cash | stacks of cash | 现金 |  |
| `mask` | 面具 | mask | a mask | 面罩 |  |
| `umbrella` | 伞 | umbrella | an umbrella | 雨伞、伞下 |  |

### 9. 景别（`shot-size`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `extreme-close-up` | 大特写 | extreme close-up | extreme close-up | 极特写、ECU | size→大特写 |
| `close-up` | 特写 | close-up | close-up | 近景、CU | size→特写 |
| `medium-close-up` | 中近景 | medium close-up | medium close-up | 中特写、MCU |  |
| `medium` | 中景 | medium shot | medium shot | 中景镜头、MS | size→中景 |
| `medium-wide` | 中全景 | medium wide shot | medium wide shot | 中全景镜头 |  |
| `wide` | 全景 | wide shot | wide shot | 全景镜头、WS | size→全景 |
| `long` | 远景 | long shot | long shot | 远景镜头、LS | size→远景 |
| `extreme-wide` | 大远景 | extreme wide shot | extreme wide shot | 极远景、EWS |  |
| `full` | 全身 | full shot | full body shot | 全身镜头 |  |
| `two-shot` | 双人镜 | two shot | two shot | 双人镜头 |  |
| `insert` | 插入镜 | insert shot | insert shot | 细节插入、插入镜头 |  |

### 10. 机位角度（`camera-angle`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `eye-level` | 平视 | eye level | eye-level angle | 水平机位 |  |
| `low-angle` | 仰拍 | low angle | low angle | 低角度 |  |
| `high-angle` | 俯拍 | high angle | high angle | 高角度 |  |
| `birds-eye` | 鸟瞰 | bird's eye view | bird's eye view | 上帝视角 |  |
| `worms-eye` | 虫视 | worm's eye view | worm's eye view | 贴地仰视 |  |
| `dutch-angle` | 斜角 | dutch angle | dutch angle | 倾斜构图、荷兰角 |  |
| `hip-level` | 腰高机位 | hip level | hip level camera | 腰平视 |  |
| `shoulder-level` | 肩高机位 | shoulder level | shoulder level camera | 肩平视 |  |
| `ground-level` | 贴地机位 | ground level | ground level camera | 地面机位 |  |
| `top-down` | 顶视 | top down | top-down shot | 垂直向下 |  |
| `over-the-shoulder` | 过肩 | over the shoulder | over the shoulder | 过肩镜、OTS |  |
| `pov` | 主观视角 | point of view | point of view | 第一视角、POV |  |
| `profile` | 侧面 | profile | profile view | 正侧 |  |
| `three-quarter` | 四分之三侧 | three quarter | three-quarter view | 斜侧面 |  |
| `back-shot` | 背面 | back view | seen from behind | 背影 |  |
| `front-on` | 正面 | front on | front on | 正面机位 |  |
| `reflection-angle` | 镜像视角 | mirror angle | shot through a mirror | 镜中视角 |  |
| `reverse-angle` | 反打 | reverse angle | reverse angle | 反打镜、正反打 |  |
| `insert-angle` | 插入机位 | insert angle | insert camera angle | 细节机位 |  |

### 11. 运镜（`camera-move`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `static` | 固定 | static camera | locked-off static camera | 机位固定、不动、静态机位 |  |
| `push-in` | 推 | dolly in | slow dolly in | 推镜、推进、推近、push in、push-in | move→推 |
| `pull-out` | 拉 | dolly out | slow dolly out | 拉镜、拉远、后拉 | move→拉 |
| `pan` | 摇 | pan | pan | 横摇、摇镜、摇摄 | move→摇 |
| `tilt` | 竖摇 | tilt | tilt | 俯仰摇、上下摇 |  |
| `truck` | 移 | truck | lateral truck | 横移、平移 | move→移 |
| `crane` | 升降 | crane | crane move | 摇臂、升降镜 | move→升降 |
| `follow` | 跟 | follow | follow shot | 跟拍、跟随 | move→跟 |
| `handheld` | 手持 | handheld | handheld camera | 手持镜头、晃动镜头 | move→手持 |
| `tracking` | 轨道跟移 | tracking | tracking shot | 轨道镜、跟轨 |  |
| `orbit` | 环绕 | orbit | orbit around the subject | 绕拍、弧线环绕 |  |
| `arc` | 弧线 | arc shot | arc shot | 弧形运动 |  |
| `whip-pan` | 甩镜 | whip pan | whip pan | 快速摇镜、swish pan |  |
| `zoom` | 变焦 | zoom | zoom | 推变焦、拉变焦 |  |
| `dolly-zoom` | 推拉变焦 | dolly zoom | dolly zoom vertigo effect | 眩晕变焦、vertigo |  |
| `steadicam` | 斯坦尼康 | steadicam | smooth steadicam move | 稳定器跟拍 |  |
| `aerial` | 航拍 | aerial | aerial drone shot | 无人机航拍、drone |  |

### 12. 镜头光学（`lens`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `wide-angle` | 广角 | wide angle | wide-angle lens | 广角镜头 |  |
| `ultra-wide` | 超广角 | ultra wide | ultra wide-angle lens | 超广 |  |
| `standard` | 标准镜头 | standard lens | 50mm standard lens | 50mm |  |
| `telephoto` | 长焦 | telephoto | telephoto lens | 长焦距 |  |
| `macro` | 微距 | macro | macro lens | 微距镜头 |  |
| `fisheye` | 鱼眼 | fisheye | fisheye lens | 鱼眼镜头 |  |
| `anamorphic` | 变形宽银幕 | anamorphic | anamorphic lens | 宽银幕、anamorphic flare |  |
| `tilt-shift` | 移轴 | tilt shift | tilt-shift lens | 移轴镜头 |  |
| `shallow-dof` | 浅景深 | shallow depth of field | shallow depth of field | 大光圈虚化、浅景深构图 |  |
| `deep-focus` | 深焦 | deep focus | deep focus | 全景深 |  |
| `soft-focus` | 柔焦 | soft focus | soft focus | 柔化 |  |
| `split-diopter` | 分光镜 | split diopter | split diopter shot | 分割焦平面 |  |
| `probe` | 探针镜头 | probe lens | probe lens shot | 管道镜头 |  |
| `snorricam` | 人肉机位 | snorricam | snorricam body-mounted camera | 身体机位 |  |
| `lens-flare` | 镜头光晕 | lens flare | lens flare | 光斑 |  |
| `pinhole` | 针孔 | pinhole | pinhole camera look | 针孔成像 |  |
| `vintage-glass` | 老镜头 | vintage glass | vintage lens rendering | 老镜味 |  |
| `compressed-perspective` | 压缩透视 | compressed perspective | compressed perspective | 长焦压缩 |  |

### 13. 构图（`composition`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `rule-of-thirds` | 三分法 | rule of thirds | rule of thirds composition | 三分构图 |  |
| `symmetry` | 对称 | symmetry | symmetrical composition | 对称构图 |  |
| `golden-ratio` | 黄金分割 | golden ratio | golden ratio composition | 黄金比例 |  |
| `leading-lines` | 引导线 | leading lines | leading lines | 线条引导 |  |
| `frame-in-frame` | 框中框 | frame in frame | frame within a frame | 框中构图 |  |
| `negative-space` | 留白 | negative space | generous negative space | 空白构图 |  |
| `foreground-occlusion` | 前景遮挡 | foreground occlusion | foreground occlusion | 前景虚挡 |  |
| `low-horizon` | 低地平线 | low horizon | low horizon line | 地平线压低 |  |
| `high-horizon` | 高地平线 | high horizon | high horizon line | 地平线抬高 |  |
| `centered` | 居中构图 | centered | centered composition | 中心构图 |  |
| `diagonal` | 对角构图 | diagonal | diagonal composition | 对角线 |  |
| `layered-depth` | 层次纵深 | layered depth | layered depth with foreground midground background | 前中后景 |  |
| `pattern` | 重复图案 | pattern repetition | repeating pattern | 图案重复 |  |
| `silhouette-comp` | 剪影构图 | silhouette composition | silhouette composition | 逆光剪影 |  |
| `reflection-comp` | 镜像构图 | reflection composition | reflection composition | 倒影构图 |  |
| `triangulation` | 三角构图 | triangular composition | triangular composition | 三角形构图 |  |

### 14. 光线（`lighting`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `high-key` | 高调光 | high key | high-key lighting | 高调照明、亮调 |  |
| `low-key` | 低调光 | low key | low-key lighting | 低调照明、暗调 |  |
| `natural` | 自然光 | natural light | natural light | 日光 |  |
| `golden-hour` | 黄金时刻 | golden hour | golden hour light | 黄昏光、夕阳 |  |
| `blue-hour` | 蓝调时刻 | blue hour | blue hour light | 黎明蓝光 |  |
| `backlight` | 逆光 | backlight | backlit | 逆光拍摄 |  |
| `rim-light` | 轮廓光 | rim light | rim light | 边缘光、发丝光 |  |
| `side-light` | 侧光 | side light | side lighting | 侧逆光 |  |
| `top-light` | 顶光 | top light | top lighting | 顶光照明 |  |
| `underlight` | 底光 | underlight | underlighting | 脚光、下方打光 |  |
| `hard-light` | 硬光 | hard light | hard light | 硬光源 |  |
| `soft-light` | 柔光 | soft light | soft light | 柔光源 |  |
| `diffused` | 漫射 | diffused | diffused lighting | 漫射光 |  |
| `directional` | 定向光 | directional | directional light | 方向光 |  |
| `practical` | 实用光源 | practical light | practical lights in frame | 道具光 |  |
| `motivated` | 动机光 | motivated light | motivated lighting | 有来源的光 |  |
| `neon` | 霓虹 | neon | neon lighting | 霓虹灯 |  |
| `candlelight` | 烛光 | candlelight | candlelight | 烛火 |  |
| `firelight` | 火光 | firelight | firelight | 篝火 |  |
| `fluorescent` | 荧光灯 | fluorescent | fluorescent lighting | 日光灯 |  |
| `tungsten` | 钨丝灯 | tungsten | warm tungsten light | 暖钨光 |  |
| `moonlight` | 月光 | moonlight | moonlight | 月色 |  |
| `overcast` | 阴天光 | overcast | overcast flat light | 阴天漫射 |  |
| `chiaroscuro` | 明暗对照 | chiaroscuro | chiaroscuro contrast | 伦勃朗光、明暗法 |  |
| `silhouette-light` | 剪影光 | silhouette light | backlit silhouette | 逆光剪影光 |  |
| `strobe` | 闪光 | strobe | strobe flash | 闪光灯 |  |
| `god-rays` | 丁达尔光 | god rays | god rays through haze | 耶稣光、光束 |  |
| `volumetric` | 体积光 | volumetric | volumetric light | 光束体积感 |  |
| `bounce` | 反射补光 | bounce light | bounced fill light | 反光板补光 |  |

### 15. 色彩（`color`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `warm-palette` | 暖调 | warm palette | warm color palette | 暖色 |  |
| `cool-palette` | 冷调 | cool palette | cool color palette | 冷色 |  |
| `monochrome` | 单色 | monochrome | monochrome | 单色调 |  |
| `black-and-white` | 黑白 | black and white | black and white | 黑白片 |  |
| `desaturated` | 低饱和 | desaturated | desaturated colors | 褪色感 |  |
| `saturated` | 高饱和 | saturated | rich saturated colors | 浓郁色彩 |  |
| `pastel` | 粉彩 | pastel | pastel palette | 马卡龙色 |  |
| `neon-palette` | 霓虹色 | neon palette | neon color palette | 荧光色 |  |
| `teal-orange` | 青橙 | teal and orange | teal and orange grade | 青橙色调 |  |
| `sepia` | 褐色调 | sepia | sepia tone | 做旧褐 |  |
| `high-contrast` | 高对比 | high contrast | high contrast | 强对比 |  |
| `low-contrast` | 低对比 | low contrast | low contrast | 灰调 |  |
| `complementary` | 互补色 | complementary | complementary colors | 对比色 |  |
| `analogous` | 类似色 | analogous | analogous colors | 邻近色 |  |
| `triadic` | 三角配色 | triadic | triadic color scheme | 三角色 |  |
| `monochrome-blue` | 蓝调 | blue monochrome | monochromatic blue | 幽蓝 |  |
| `red-accent` | 红色点缀 | red accent | a single red accent | 朱红点睛 |  |
| `warm-temperature` | 暖色温 | warm temperature | warm color temperature | 偏暖 |  |
| `cool-temperature` | 冷色温 | cool temperature | cool color temperature | 偏冷 |  |
| `split-tone` | 分离色调 | split tone | split toning | 分离调色 |  |
| `bleach-bypass` | 漂白旁路 | bleach bypass | bleach bypass grade | 银盐冲洗感 |  |
| `technicolor` | 特艺彩色 | technicolor | technicolor look | 三色染印 |  |

### 16. 剪辑节奏（`editing`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `long-take` | 长镜头 | long take | long take | 长镜头调度 |  |
| `one-shot` | 一镜到底 | one shot | one continuous shot | 无缝长镜头 |  |
| `montage` | 蒙太奇 | montage | montage editing | 剪辑蒙太奇 |  |
| `jump-cut` | 跳切 | jump cut | jump cut | 跳跃剪辑 |  |
| `crosscut` | 交叉剪辑 | cross cutting | cross cutting | 平行剪辑 |  |
| `match-cut` | 匹配剪辑 | match cut | match cut | 匹配转场 |  |
| `smash-cut` | 硬切 | smash cut | smash cut | 生硬切换 |  |
| `fade` | 淡入淡出 | fade | fade to black | 渐隐 |  |
| `dissolve` | 叠化 | dissolve | dissolve transition | 溶接 |  |
| `wipe` | 划像 | wipe | wipe transition | 划变 |  |
| `slow-motion` | 慢动作 | slow motion | slow motion | 升格、慢镜 |  |
| `time-lapse` | 延时 | time lapse | time lapse | 延时摄影 |  |
| `fast-motion` | 快动作 | fast motion | fast motion | 降格 |  |
| `freeze-frame` | 定格 | freeze frame | freeze frame | 定格画面 |  |
| `rhythmic-cut` | 节奏剪辑 | rhythmic cutting | rhythmic cutting to the beat | 卡点剪辑 |  |
| `ellipsis` | 省略剪辑 | elliptical editing | elliptical editing | 跳时剪辑 |  |
| `continuity` | 连续性剪辑 | continuity editing | continuity editing | 无缝剪辑 |  |
| `non-linear-edit` | 非线性剪辑 | non-linear editing | non-linear editing | 乱序剪辑 |  |
| `split-screen` | 分屏 | split screen | split screen | 分割画面 |  |

### 17. 声音音乐（`sound`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `diegetic` | 画内音 | diegetic sound | diegetic sound | 同期声 |  |
| `non-diegetic` | 画外音 | non-diegetic sound | non-diegetic sound | 非画内音 |  |
| `voice-over` | 旁白 | voice over | voice-over narration | 内心独白 |  |
| `foley` | 拟音 | foley | detailed foley | 动作拟音 |  |
| `ambient` | 环境声 | ambient sound | ambient room tone | 背景环境音 |  |
| `silence` | 静默 | silence | complete silence | 无声 |  |
| `score` | 配乐 | score | orchestral score | 原声配乐 |  |
| `soundtrack` | 歌曲 | soundtrack song | featured song | 插曲 |  |
| `sound-bridge` | 声音过渡 | sound bridge | sound bridge | 声音桥 |  |
| `off-screen-sound` | 画外声源 | off-screen sound | off-screen sound | 画外音效 |  |
| `whispered` | 低语 | whispered | whispered dialogue | 耳语 |  |
| `echo-reverb` | 混响 | reverb | long reverb tail | 回响 |  |
| `muffled` | 闷音 | muffled | muffled distant sound | 隔墙闷响 |  |
| `orchestral` | 管弦 | orchestral | full orchestral arrangement | 交响 |  |
| `electronic` | 电子乐 | electronic | electronic synth score | 合成器 |  |
| `percussion` | 打击乐 | percussion | driving percussion | 鼓点 |  |
| `natural-sound` | 自然声 | natural sound | natural location sound | 现场收音 |  |

### 18. 影像风格与媒介（`style-medium`）

| id | 中文 | English | token | 别名 | 其它映射 |
| --- | --- | --- | --- | --- | --- |
| `live-action` | 实拍 | live action | live action | 真人实拍 |  |
| `ai-generated` | AI 生成 | AI generated | AI generated video | AI 视频 |  |
| `avatar` | 数字人 | digital avatar | digital avatar presenter | 数字人口播 |  |
| `cg-3d` | 3D 渲染 | 3D rendered | 3D rendered | 三维渲染 |  |
| `code-render` | 代码渲染 | code rendered | code-generated graphics | 程序化渲染 |  |
| `screen-capture` | 屏幕录制 | screen capture | screen recording | 录屏 |  |
| `still-motion` | 静帧动效 | still with motion | still image with camera motion | 静态图推拉 |  |
| `static-hold` | 静帧停留 | static still | static still frame | 图片停留 |  |
| `anime-2d` | 2D 动画 | 2D animation | hand-drawn 2D anime | 二维动画、日式动画 |  |
| `stop-motion-puppet` | 定格动画 | stop motion | stop motion animation | 逐格动画 |  |
| `film-footage` | 影视片段 | film footage | existing film footage | 电影素材 |  |
| `cinematic-realistic` | 电影写实 | cinematic realistic | cinematic photorealistic | 电影级写实 |  |
| `cinematic-ai` | AI 电影感 | cinematic AI | cinematic AI look | AI 电影质感 |  |
| `cyberpunk-style` | 赛博朋克视觉 | cyberpunk style | cyberpunk visual style | 赛博视觉 |  |
| `retro-vintage` | 复古 | retro vintage | vintage retro look | 复古质感 |  |
| `documentary-style` | 纪实风 | documentary style | documentary style | 纪实影像 |  |
| `surreal-collage` | 超现实拼贴 | surreal collage | surreal collage | 拼贴艺术 |  |
| `storyboard` | 分镜稿 | storyboard | storyboard sketch | 分镜图 |  |
| `game-cinematic` | 游戏过场 | game cinematic | game cinematic | 游戏 CG |  |
| `ugc-style` | UGC 自拍 | UGC style | UGC selfie style | 用户自拍风 |  |
| `chinese-ink` | 水墨 | chinese ink | east asian ink wash painting | 水墨画、国画 |  |
| `claymation` | 黏土定格 | claymation | claymation | 黏土动画 |  |
| `paper-cut` | 剪纸 | paper cut | paper cutout animation | 剪纸动画 |  |
| `watercolor` | 水彩 | watercolor | watercolor painting | 水彩画 |  |
| `oil-painting` | 油画 | oil painting | oil painting | 古典油画 |  |
| `pixel-art` | 像素 | pixel art | pixel art | 像素风 |  |
| `low-poly` | 低多边形 | low poly | low poly 3D | 低模 |  |
| `cel-shaded` | 赛璐璐 | cel shaded | cel shaded anime | 赛璐璐上色 |  |
| `comic-panel` | 漫画分格 | comic panel | comic book panel | 美漫分镜 |  |
| `photoreal` | 照片级写实 | photorealistic | photorealistic | 超写实 |  |
| `mockumentary-style` | 伪纪录片感 | mockumentary style | mockumentary handheld style | 伪纪录风 |  |
| `vhs` | 录像带 | VHS | VHS tape texture | VHS 质感 |  |
| `film-grain` | 胶片颗粒 | film grain | fine film grain | 颗粒感 |  |
| `glitch` | 故障艺术 | glitch art | glitch art | 故障风 |  |
| `vaporwave` | 蒸汽波 | vaporwave | vaporwave aesthetic | 蒸汽波风 |  |
| `minimal-flat` | 极简扁平 | minimal flat | minimal flat design | 扁平插画 |  |
| `surrealist-paint` | 超现实绘画 | surrealist painting | surrealist painting style | 超现实画风 |  |
| `ukiyo-e` | 浮世绘 | ukiyo-e | ukiyo-e woodblock print | 日本浮世绘 |  |
| `steampunk` | 蒸汽朋克 | steampunk | steampunk aesthetic | 蒸汽朋克风 |  |

## 来源分类映射（sourceMappings.vflow）

| 输入 | 映射到 |
| --- | --- |
| cinematic realistic | style-medium:cinematic-realistic |
| urban | environment:street |
| vlog | genre:vlog |
| character | genre:character-piece、subject:human |
| music video | genre:music-video |
| storyboard | style-medium:storyboard |
| 3D cartoon | style-medium:cg-3d、genre:animation |
| fantasy | genre:fantasy |
| cinematic AI | style-medium:cinematic-ai |
| sports | genre:sports |
| commercial | genre:commercial |
| food | genre:culinary、subject:food |
| travel | genre:travel |
| anime | style-medium:anime-2d、genre:animation |
| product | genre:product、subject:product |
| cyberpunk | genre:cyberpunk、style-medium:cyberpunk-style |
| vintage retro | style-medium:retro-vintage |
| documentary | genre:documentary、style-medium:documentary-style |
| vehicle | subject:vehicle |
| architecture interior | genre:architecture、subject:interior |
| short film | genre:short-film |
| abstract | genre:experimental、style-medium:glitch |
| surreal | genre:surreal、tone:eerie |
| channel intro | genre:channel-intro |
| animal | genre:animal、subject:animal |
| game cinematic | style-medium:game-cinematic |
| UGC | style-medium:ugc-style |
| stop motion | style-medium:stop-motion-puppet、genre:animation |
| tutorial | genre:tutorial |
| nature | genre:nature |
| chinese ink | style-medium:chinese-ink |

## 反推制作方式映射（kindMappings）

| 输入 | 映射到 |
| --- | --- |
| live_action | style-medium:live-action |
| ai_video | style-medium:ai-generated |
| avatar | style-medium:avatar |
| cg_3d | style-medium:cg-3d |
| code_render | style-medium:code-render |
| screen_capture | style-medium:screen-capture |
| still_motion | style-medium:still-motion |
| static_hold | style-medium:static-hold |
| anim_2d | style-medium:anime-2d |
| stop_motion | style-medium:stop-motion-puppet |
| film_footage | style-medium:film-footage |
