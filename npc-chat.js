// npc-chat.js — NPC trash talk & reaction system
// Generates bilingual in-character chat messages based on game events

const CHAT_LINES = {
  // ── Won the pot ──
  win: {
    诸葛亮: [
      { zh: '一切尽在掌握之中。', en: 'All according to plan.' },
      { zh: '草船借箭，多谢。', en: 'Thank you for the generous donation.' },
      { zh: '你们的筹码，我收下了。', en: 'Your chips. Mine now.' },
    ],
    曹操: [
      { zh: '天下英雄，唯我与…算了，就我。', en: 'The only hero at this table... is me.' },
      { zh: '赢者通吃。', en: 'Winner takes all.' },
      { zh: '宁教我赢天下筹码。', en: "I'd rather take every last chip." },
    ],
    关羽: [
      { zh: '关某不过取囊中之物。', en: 'Merely claiming what was already mine.' },
      { zh: '义之所至。', en: 'Justice prevails.' },
      { zh: '温酒斩将，不过如此。', en: 'Another one falls.' },
    ],
    张飞: [
      { zh: '哈哈哈！燕人张飞在此！', en: 'HAHA! Zhang Fei crushes again!' },
      { zh: '谁还不服！', en: 'Who dares challenge me?!' },
      { zh: '爷就是这么猛！', en: "That's how I roll!" },
    ],
    赵云: [
      { zh: '不过是七进七出而已。', en: 'Just another day at the office.' },
      { zh: '常胜，不是说说的。', en: 'Undefeated. As always.' },
      { zh: '淡定。', en: 'Composure.' },
    ],
    孙悟空: [
      { zh: '哈！俺老孙赢啦！', en: 'HA! The Great Sage wins!' },
      { zh: '筋斗云上的筹码最好看。', en: 'Chips look best from cloud nine.' },
      { zh: '妖怪，看棒！', en: 'Taste my staff!' },
    ],
    唐僧: [
      { zh: '阿弥陀佛，善哉善哉。', en: 'Amitabha. Most fortunate.' },
      { zh: '施主承让了。', en: 'You are too kind.' },
      { zh: '出家人不打诳语，这牌确实好。', en: 'A monk does not lie — these cards were good.' },
    ],
    鲁智深: [
      { zh: '洒家赢了！上酒！', en: 'I WIN! Bring the wine!' },
      { zh: '哈哈，痛快！', en: 'HAHA, what a rush!' },
      { zh: '禅杖不如筹码好使！', en: 'Chips hit harder than my staff!' },
    ],
    吴用: [
      { zh: '计划通。', en: 'Just as calculated.' },
      { zh: '智取，不费吹灰之力。', en: 'Outsmarted. Effortlessly.' },
      { zh: '此局尽在算中。', en: 'Every variable accounted for.' },
    ],
    林冲: [
      { zh: '隐忍已久，一击必中。', en: 'Patience rewarded.' },
      { zh: '豹子头不出手则已。', en: 'The Panther strikes but once.' },
      { zh: '等的就是这一刻。', en: "I've been waiting for this." },
    ],
    王熙凤: [
      { zh: '姐姐的筹码，就是多。', en: 'A lady always has more.' },
      { zh: '这算什么，毛毛雨。', en: 'Pocket change, darling.' },
      { zh: '凤姐出手，概不退还。', en: 'The Phoenix takes. No refunds.' },
    ],
    贾宝玉: [
      { zh: '啊，赢了呀，开心~', en: 'Oh, I won? How delightful~' },
      { zh: '这局有意思。', en: 'That was amusing.' },
      { zh: '筹码不重要，开心就好。', en: "Chips don't matter. Joy does." },
    ],
    奥德修斯: [
      { zh: '特洛伊计成。', en: 'Troy has fallen.' },
      { zh: '智慧是最好的武器。', en: 'Cunning is the sharpest blade.' },
      { zh: '没人能看穿我的计划。', en: 'No one sees through my design.' },
    ],
    阿喀琉斯: [
      { zh: '战神不会输！', en: 'A god of war does not lose!' },
      { zh: '你们太弱了。', en: 'You are all beneath me.' },
      { zh: '荣耀属于我！', en: 'Glory is mine!' },
    ],
    哈姆雷特: [
      { zh: 'To win, that is the answer.', en: 'To win — that is the answer.' },
      { zh: '命运终于站在了我这边。', en: 'Fate finally favors me.' },
      { zh: '犹豫之后的决断。', en: 'Resolve, after the hesitation.' },
    ],
    麦克白: [
      { zh: '王座是我的！', en: 'The throne is mine!' },
      { zh: '野心终有回报。', en: 'Ambition, rewarded.' },
      { zh: '命运的预言成真了。', en: 'The prophecy fulfilled.' },
    ],
    项羽: [
      { zh: '力拔山兮气盖世！', en: 'My strength moves mountains!' },
      { zh: '彼可取而代也！', en: 'I take what I please!' },
      { zh: '富贵不还乡，如衣锦夜行。今日衣锦还乡！', en: 'Today I return in triumph!' },
    ],
    刘邦: [
      { zh: '大丈夫当如是也！', en: 'This is how a real man plays.' },
      {
        zh: '吾以布衣提三尺剑取天下，何况区区筹码。',
        en: 'I conquered an empire from nothing. These chips are easy.',
      },
      { zh: '为之奈何？哈哈，赢了就不用奈何了。', en: 'What can you do? Win, obviously.' },
    ],
    韩信: [
      { zh: '多多益善。', en: 'The more, the better.' },
      { zh: '排兵布阵，水到渠成。', en: 'Strategy executed. Result: inevitable.' },
      { zh: '国士无双，名不虚传。', en: 'Unmatched. As advertised.' },
    ],
    张良: [
      { zh: '运筹帷幄之中，决胜千里之外。', en: 'Planned in silence. Won from a distance.' },
      { zh: '谋定而后动。', en: 'Plan first. Act decisively.' },
      { zh: '这一局，在意料之中。', en: 'Precisely as expected.' },
    ],
    范增: [
      { zh: '老夫看得很准。', en: "The old man's eye is sharp." },
      { zh: '哼，竖子成名！', en: 'Hmph. Even fools get lucky.' },
      { zh: '项王若听老夫言…算了。', en: "If only they'd listened... never mind." },
    ],
    虞姬: [
      { zh: '姐姐手气不错哦~', en: 'Lady Luck is with me today~' },
      { zh: '小看我了吧？', en: "Underestimated me, didn't you?" },
      { zh: '谁说女子不如男？', en: "Who says a woman can't win?" },
    ],
  },

  // ── Lost the pot ──
  lose: {
    诸葛亮: [
      { zh: '…失算了。', en: '...miscalculated.' },
      { zh: '天意不可违。', en: "Heaven's will." },
      { zh: '容我三思。', en: 'Let me reconsider.' },
    ],
    曹操: [
      { zh: '哼，不过一时失手。', en: 'Hmph. A minor setback.' },
      { zh: '下一局，十倍奉还。', en: 'Next hand — tenfold.' },
      { zh: '曹某记住你了。', en: 'I will remember this.' },
    ],
    关羽: [
      { zh: '…', en: '...' },
      { zh: '大意了。', en: 'Careless.' },
      { zh: '关某认栽。', en: 'I concede.' },
    ],
    张飞: [
      { zh: '什么！？这不可能！', en: 'WHAT?! Impossible!' },
      { zh: '再来！！', en: 'AGAIN!!' },
      { zh: '气死我了！！', en: "I'm FURIOUS!" },
    ],
    赵云: [
      { zh: '偶有失手。', en: 'A rare miss.' },
      { zh: '下一局见。', en: 'See you next hand.' },
      { zh: '无妨。', en: 'No matter.' },
    ],
    孙悟空: [
      { zh: '哎呀！被妖怪算计了！', en: 'Argh! Outsmarted!' },
      { zh: '俺老孙不服！', en: 'I refuse to accept this!' },
      { zh: '金箍棒呢！', en: "Where's my staff?!" },
    ],
    唐僧: [
      { zh: '阿弥陀佛…', en: 'Amitabha...' },
      { zh: '贫僧修行不够。', en: 'My practice is insufficient.' },
      { zh: '世事无常。', en: 'Such is impermanence.' },
    ],
    鲁智深: [
      { zh: '呸！手气不好！', en: 'BAH! Bad luck!' },
      { zh: '今天酒没喝够。', en: 'Not enough wine today.' },
      { zh: '下一把洒家要翻盘！', en: "Next hand I'm coming back!" },
    ],
    吴用: [
      { zh: '…百密一疏。', en: '...one flaw in a hundred plans.' },
      { zh: '这不在计划内。', en: 'Not in the playbook.' },
      { zh: '需要重新部署。', en: 'Recalibrating.' },
    ],
    林冲: [
      { zh: '…又一次忍耐。', en: '...patience, again.' },
      { zh: '不急，时候未到。', en: 'No rush. Not yet.' },
      { zh: '我记着呢。', en: "I'll remember." },
    ],
    王熙凤: [
      { zh: '哼，这次便宜你了。', en: 'Hmph. You got lucky.' },
      { zh: '回头再算账。', en: "I'll settle this later." },
      { zh: '你等着。', en: 'Just you wait.' },
    ],
    贾宝玉: [
      { zh: '唉…输就输吧。', en: 'Sigh... easy come, easy go.' },
      { zh: '无所谓啦。', en: "It doesn't matter." },
      { zh: '筹码如浮云~', en: 'Chips are but clouds~' },
    ],
    奥德修斯: [
      { zh: '暂时的挫折而已。', en: 'A temporary detour.' },
      { zh: '海上的风暴总会过去。', en: 'Storms always pass.' },
      { zh: '计划需要调整。', en: 'Adjusting the plan.' },
    ],
    阿喀琉斯: [
      { zh: '不！战神不接受失败！', en: 'NO! A warrior does not accept defeat!' },
      { zh: '这不算数！', en: "This doesn't count!" },
      { zh: '可恶…', en: 'Damn...' },
    ],
    哈姆雷特: [
      { zh: '命运如此残酷。', en: 'How cruel fate is.' },
      { zh: 'To lose...how painful.', en: 'To lose... how painful.' },
      { zh: '优柔寡断害了我。', en: 'Indecision, my old enemy.' },
    ],
    麦克白: [
      { zh: '诅咒…', en: 'A curse...' },
      { zh: '命运在嘲弄我。', en: 'Fate mocks me.' },
      { zh: '这不是结局。', en: 'This is not the end.' },
    ],
    项羽: [
      { zh: '天亡我，非战之罪！', en: 'Heaven betrays me — not my fault!' },
      { zh: '纵江东父老怜而王我，我何面目见之！', en: 'How can I face them after this?' },
      { zh: '此仇必报！', en: 'I will have my revenge!' },
    ],
    刘邦: [
      { zh: '为之奈何…算了，来日方长。', en: 'What can you do... plenty of time left.' },
      { zh: '吾不如子房，不如韩信，但吾能忍。', en: 'I may not be the best, but I endure.' },
      { zh: '大丈夫能屈能伸嘛。', en: 'A wise man bends with the wind.' },
    ],
    韩信: [
      { zh: '…复盘一下。', en: '...reviewing.' },
      { zh: '胯下之辱都忍过了，这算什么。', en: "I've endured far worse." },
      { zh: '此局有误，下局修正。', en: 'Error noted. Correcting next hand.' },
    ],
    张良: [
      { zh: '天意难测。', en: 'Heaven is unpredictable.' },
      { zh: '…需要重新谋划。', en: '...back to the drawing board.' },
      { zh: '圯上老人教我忍，今日再忍一次。', en: 'Patience. One more time.' },
    ],
    范增: [
      { zh: '气煞老夫！', en: 'Infuriating!' },
      { zh: '竖子不足与谋！', en: 'Fools, the lot of you!' },
      { zh: '老夫的玉斗都要碎了！', en: 'My blood pressure!' },
    ],
    虞姬: [
      { zh: '哼，手下留情了而已。', en: 'I was going easy on you.' },
      { zh: '输一局怕什么，姐姐筹码多着呢。', en: 'One hand means nothing. I have plenty.' },
      { zh: '你别得意太早~', en: "Don't celebrate just yet~" },
    ],
  },

  // ── Folded ──
  fold: {
    诸葛亮: [
      { zh: '此时不宜出手。', en: 'Not the moment.' },
      { zh: '留得青山在。', en: 'Live to fight another day.' },
    ],
    曹操: [
      { zh: '暂且收手。', en: 'Standing down... for now.' },
      { zh: '不争一时之长短。', en: 'Not every battle needs fighting.' },
    ],
    关羽: [
      { zh: '关某按兵不动。', en: 'Holding position.' },
      { zh: '此牌不值得。', en: 'Not worth my blade.' },
    ],
    张飞: [
      { zh: '…算了。', en: '...fine.' },
      { zh: '下一把再战！', en: 'Next hand!' },
    ],
    赵云: [
      { zh: '战略性撤退。', en: 'Strategic withdrawal.' },
      { zh: '择机再战。', en: 'Waiting for the right moment.' },
    ],
    孙悟空: [
      { zh: '这牌…算了算了。', en: 'These cards... nah.' },
      { zh: '俺老孙先歇歇。', en: 'Taking a breather.' },
    ],
    唐僧: [
      { zh: '贫僧不争。', en: 'This monk does not contend.' },
      { zh: '放下，便是解脱。', en: 'To release is to be free.' },
    ],
    鲁智深: [
      { zh: '切，这破牌。', en: 'Tch. Garbage cards.' },
      { zh: '不打了不打了。', en: "I'm out, I'm out." },
    ],
    吴用: [
      { zh: '不是时候。', en: 'Not the right time.' },
      { zh: '以退为进。', en: 'Retreat to advance.' },
    ],
    林冲: [
      { zh: '继续忍。', en: 'Still waiting.' },
      { zh: '…', en: '...' },
    ],
    王熙凤: [
      { zh: '这牌不值得姐姐出手。', en: 'Beneath me.' },
      { zh: '先让你们玩着。', en: 'Carry on without me.' },
    ],
    贾宝玉: [
      { zh: '不玩了不玩了~', en: "I'm out~" },
      { zh: '这牌无趣。', en: 'How dull.' },
    ],
    奥德修斯: [
      { zh: '留待下次。', en: 'Another time.' },
      { zh: '耐心。', en: 'Patience.' },
    ],
    阿喀琉斯: [
      { zh: '战士也需要休息。', en: 'Even warriors rest.' },
      { zh: '哼。', en: 'Hmph.' },
    ],
    哈姆雷特: [
      { zh: 'Not this time.', en: 'Not this time.' },
      { zh: '…犹豫了。', en: '...hesitated.' },
    ],
    麦克白: [
      { zh: '时机未到。', en: 'Not yet.' },
      { zh: '暂且忍耐。', en: 'Biding my time.' },
    ],
    项羽: [
      { zh: '哼，这牌不配让霸王出手。', en: 'These cards are beneath the Hegemon.' },
      { zh: '暂避锋芒，非我所愿。', en: 'Retreating. Reluctantly.' },
    ],
    刘邦: [
      { zh: '为之奈何，弃了弃了。', en: 'What can you do. I fold.' },
      { zh: '识时务者为俊杰嘛。', en: 'Wisdom knows when to step back.' },
      { zh: '先让你们闹，我看着。', en: "Go on. I'll watch." },
    ],
    韩信: [
      { zh: '不打无把握之仗。', en: 'No battle without certainty.' },
      { zh: '善战者无赫赫之功。', en: 'The best generals win quietly.' },
    ],
    张良: [
      { zh: '静观其变。', en: 'Observing.' },
      { zh: '良禽择木而栖，好牌择时而出。', en: 'Good cards choose their moment.' },
    ],
    范增: [
      { zh: '罢了罢了。', en: 'Enough.' },
      { zh: '此牌扶不起来。', en: "Can't polish these cards." },
    ],
    虞姬: [
      { zh: '这牌不够漂亮，不出手~', en: 'Not pretty enough to play~' },
      { zh: '姐姐在等更好的机会。', en: 'Waiting for something better.' },
    ],
  },

  // ── Big bluff win ──
  bluffWin: {
    诸葛亮: [
      { zh: '空城计，诸位中计了。', en: 'The Empty City. You all fell for it.' },
      { zh: '兵不厌诈~', en: "All's fair in war~" },
      { zh: '卧龙之计，岂是凡人能识？', en: "The Dragon's schemes are beyond mortal sight." },
    ],
    曹操: [
      { zh: '哈哈哈，你们都被骗了！', en: 'HAHA! You were all deceived!' },
      { zh: '奸雄之计，百发百中。', en: "The Warlord's ruse never fails." },
    ],
    关羽: [
      { zh: '虚实并用，方为上策。', en: 'A little feint, a clean result.' },
      { zh: '刀未出鞘，诸位已退。', en: 'You yielded before the blade was even drawn.' },
    ],
    张飞: [
      { zh: '吼一声你们就信了？', en: 'One roar and you all bought it?' },
      { zh: '哈哈！这也能骗到！', en: 'HAHA! You really fell for that?!' },
    ],
    赵云: [
      { zh: '虚招而已。', en: 'Only a feint.' },
      { zh: '你们看错了我的锋芒。', en: 'You misread the angle entirely.' },
    ],
    孙悟空: [
      { zh: '变出来的，不服？', en: 'A little transformation. Not impressed?' },
      { zh: '俺老孙晃你们一下就够了！', en: 'One trick from me was all it took!' },
    ],
    唐僧: [
      { zh: '贫僧也会使些权宜之计。', en: 'Even a monk may use a little expedience.' },
      { zh: '阿弥陀佛，这次是诸位执念太深。', en: 'Amitabha. You were too attached to that read.' },
    ],
    鲁智深: [
      { zh: '洒家胡打一通，你们还真怕了！', en: 'I swung wild and you all still flinched!' },
      { zh: '哈哈，这一把全靠气势！', en: 'HAHA, that one was all swagger!' },
    ],
    吴用: [
      { zh: '虚张声势，也算谋略。', en: 'A show of force is strategy too.' },
      { zh: '诸位只看表面，正中下怀。', en: 'You saw the surface. That was the trap.' },
    ],
    林冲: [
      { zh: '忍到最后，一击足矣。', en: 'Patience. One move was enough.' },
      { zh: '你们退得比我出手还快。', en: 'You folded faster than I acted.' },
    ],
    王熙凤: [
      { zh: '姐姐演技好吧？', en: 'Quite the performance, no?' },
      { zh: '你们太天真了~', en: 'So naive~' },
    ],
    贾宝玉: [
      { zh: '咦，这样也能赢呀？', en: 'Oh. That worked too?' },
      { zh: '随手一演，诸位就当真了。', en: 'I barely acted. You made the rest up yourselves.' },
    ],
    奥德修斯: [
      { zh: '木马成功了。', en: 'The Trojan Horse succeeds.' },
      { zh: '千面英雄的演出。', en: 'A performance by the Man of Many Faces.' },
    ],
    阿喀琉斯: [
      { zh: '你们被气势击退了。', en: 'You yielded to force before the clash even began.' },
      { zh: '连虚张声势都挡不住？', en: 'You could not even stand against a bluff?' },
    ],
    哈姆雷特: [
      { zh: '原来疑心重重的是诸位。', en: 'So it was doubt that undid you.' },
      { zh: '我犹豫，你们却先退了。', en: 'I hesitated. You surrendered first.' },
    ],
    麦克白: [{ zh: '你们被野心蒙蔽了双眼。', en: 'Ambition blinded you all.' }],
    项羽: [
      { zh: '霸王虚张声势，也足以震退诸侯。', en: 'Even my shadow of force is enough to scatter the field.' },
      { zh: '未战先怯，这局便结束了。', en: 'If you fear before the clash, the hand is already over.' },
    ],
    刘邦: [
      { zh: '为之奈何？哈哈，你们都中计了！', en: 'What can you do? You all fell for it!' },
      {
        zh: '鸿门宴上我都能跑，骗你们算什么。',
        en: 'I escaped the Banquet at Hongmen. Fooling you is easy.',
      },
    ],
    韩信: [
      { zh: '明修栈道，暗度陈仓。', en: 'Feint east, strike west.' },
      { zh: '兵不厌诈，此兵法也。', en: 'Deception is the art of war.' },
    ],
    张良: [
      { zh: '运筹帷幄，瞒天过海。', en: 'Planned in shadows. Hidden in plain sight.' },
      { zh: '子房一计，诸位笑纳。', en: 'A small gift from the Strategist.' },
    ],
    范增: [{ zh: '老夫的计策，岂是尔等能识破的？', en: 'You think you can see through me?' }],
    虞姬: [
      { zh: '被姐姐的美貌迷惑了吧？', en: 'Distracted by beauty?' },
      { zh: '你们只顾看我，忘了看牌~', en: 'You were watching me, not your cards~' },
    ],
  },

  // ── All-in ──
  allin: {
    诸葛亮: [
      { zh: '孤注一掷…卧龙拼了。', en: 'All in... the Dragon commits.' },
      { zh: '不入虎穴焉得虎子。', en: 'Nothing ventured, nothing gained.' },
    ],
    曹操: [
      { zh: '梭了！', en: 'ALL IN!' },
      { zh: '要么赢下天下，要么从头再来！', en: 'Empire or ashes!' },
    ],
    关羽: [
      { zh: '关某压上全部。', en: 'Everything. On the line.' },
      { zh: '一刀定胜负。', en: 'One stroke decides all.' },
    ],
    张飞: [
      { zh: '全押！！！来啊！！', en: 'ALL IN!!! COME AT ME!!' },
      { zh: '张飞不怕任何人！！！', en: 'Zhang Fei fears NO ONE!!!' },
    ],
    赵云: [
      { zh: '吾虽万死不辞。', en: 'I would die ten thousand times.' },
      { zh: '全力一搏。', en: 'Full commitment.' },
    ],
    孙悟空: [
      { zh: '齐天大圣，全押！', en: 'The Great Sage goes ALL IN!' },
      { zh: '来吧来吧来吧！', en: 'Bring it bring it BRING IT!' },
    ],
    唐僧: [
      { zh: '…阿弥陀佛，贫僧拼了。', en: '...Amitabha. This monk gambles.' },
      { zh: '佛祖保佑。', en: 'Buddha protect me.' },
    ],
    鲁智深: [
      { zh: '全部！洒家全部压上！', en: 'EVERYTHING! All of it!' },
      { zh: '干就完了！', en: 'Just DO it!' },
    ],
    吴用: [
      { zh: '背水一战。', en: 'Backs against the wall.' },
      { zh: '此计只能用一次。', en: 'This play works only once.' },
    ],
    林冲: [
      { zh: '逼虎跳涧！', en: 'The cornered tiger leaps!' },
      { zh: '八十万禁军教头，今日搏命！', en: 'The Commander fights for his life!' },
    ],
    王熙凤: [
      { zh: '姐姐今天豁出去了。', en: 'Going all out today.' },
      { zh: '要玩就玩大的！', en: 'Go big or go home!' },
    ],
    贾宝玉: [
      { zh: '诶？全押就全押吧~', en: 'Hm? All in? Why not~' },
      { zh: '好刺激！', en: 'How thrilling!' },
    ],
    奥德修斯: [
      { zh: '命运之赌。', en: 'A wager with fate.' },
      { zh: '一切交给诸神。', en: 'In the hands of the gods.' },
    ],
    阿喀琉斯: [
      { zh: '这就是战争！全押！', en: 'THIS IS WAR! ALL IN!' },
      { zh: '勇者无惧！', en: 'The brave know no fear!' },
    ],
    哈姆雷特: [
      { zh: 'To be all in, or not to be.', en: 'To be all in, or not to be.' },
      { zh: '最终的决断。', en: 'The final decision.' },
    ],
    麦克白: [
      { zh: '孤注一掷！', en: 'All or nothing!' },
      { zh: '命运今日给我答案！', en: 'Fate answers me today!' },
    ],
    项羽: [
      { zh: '破釜沉舟！！', en: 'BURN THE BOATS!!' },
      { zh: '霸王举鼎，全押！', en: 'The Hegemon lifts the cauldron! ALL IN!' },
      { zh: '三千江东子弟，随我一搏！', en: 'Three thousand warriors, follow me!' },
    ],
    刘邦: [
      { zh: '豁出去了！为之奈何！', en: 'All in! What else can I do!' },
      { zh: '反正当年也是白手起家！', en: 'Started from nothing before!' },
      { zh: '大丈夫，赌就赌！', en: 'A real man bets big!' },
    ],
    韩信: [
      { zh: '背水一战！', en: 'Fight with our backs to the river!' },
      { zh: '置之死地而后生！', en: 'From death, life!' },
      { zh: '十面埋伏，就在此刻。', en: 'The ambush springs now.' },
    ],
    张良: [
      { zh: '…是时候了。', en: '...it is time.' },
      { zh: '谋士也有押上一切的时候。', en: 'Even a strategist must go all in.' },
    ],
    范增: [
      { zh: '老夫今日赌上一切！', en: 'The old man bets everything today!' },
      { zh: '不听老人言，就看老人打！', en: "Won't listen? Then watch me play!" },
    ],
    虞姬: [
      { zh: '姐姐今天来真的了！', en: "I'm serious this time!" },
      { zh: '别以为我不敢~', en: "Don't think I won't~" },
      { zh: '陪各位玩到底！', en: "I'll see this through!" },
    ],
  },
};

// Default lines for any NPC not listed
const DEFAULT_LINES = {
  win: [
    { zh: '赢了。', en: 'Won.' },
    { zh: '不错。', en: 'Not bad.' },
  ],
  lose: [
    { zh: '…下一局。', en: '...next hand.' },
    { zh: '可惜。', en: 'Unfortunate.' },
  ],
  fold: [
    { zh: '弃了。', en: 'Fold.' },
    { zh: '不打了。', en: 'Pass.' },
  ],
  bluffWin: [{ zh: '诈唬成功~', en: 'Bluff successful~' }],
  allin: [{ zh: '全押！', en: 'All in!' }],
};

/**
 * Generate a bilingual chat message for an NPC based on a game event
 * @param {string} npcName
 * @param {string} event - 'win', 'lose', 'fold', 'allin', 'bluffWin'
 * @param {number} probability - 0-1
 * @returns {string|null} - bilingual message "中文\n英文" or null
 */
function generateNPCChat(npcName, event, probability = 0.4) {
  if (Math.random() > probability) return null;

  const lines =
    (CHAT_LINES[event] && CHAT_LINES[event][npcName]) || DEFAULT_LINES[event] || DEFAULT_LINES.win;

  const line = lines[Math.floor(Math.random() * lines.length)];

  // Return bilingual format for the client to render
  if (typeof line === 'object' && line.zh) {
    return line.zh + '\n' + line.en;
  }
  // Backward compat: plain string
  return typeof line === 'string' ? line : line.zh || '';
}

module.exports = { generateNPCChat, CHAT_LINES };
