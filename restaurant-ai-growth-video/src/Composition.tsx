import React from "react";
import {Audio, Video} from "@remotion/media";
import {
  AbsoluteFill,
  Composition,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const FPS = 30;
const INK = "#0b1112";

type SceneProps = {duration: number};

const sceneOpacity = (frame: number, duration: number) =>
  interpolate(frame, [0, 12, duration - 14, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });

const reveal = (frame: number, start: number, end = start + 18) => ({
  opacity: interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }),
  translate: `0px ${interpolate(frame, [start, end + 8], [32, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })}px`,
});

const Brand = () => <div className="brand">餐厅AI增长服务</div>;

const SceneHeader: React.FC<{number: string; title: string}> = ({number, title}) => (
  <div className="scene-header"><span>{number}</span>{title}</div>
);

const Film: React.FC<{
  src: string;
  startFrom?: number;
  darken?: number;
  position?: string;
}> = ({src, startFrom = 0, darken = 0.4, position = "center"}) => (
  <AbsoluteFill>
    <Video
      src={staticFile(src)}
      trimBefore={startFrom}
      muted
      loop
      objectFit="cover"
      style={{width: "100%", height: "100%", objectPosition: position}}
    />
    <AbsoluteFill style={{background: `rgba(5,10,11,${darken})`}} />
  </AbsoluteFill>
);

const Voice: React.FC<{file: string}> = ({file}) => <Audio src={staticFile(`audio/${file}.mp3`)} volume={1} />;

const BigLine: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <h1 className="big-line" style={style}>{children}</h1>
);

const SceneOne: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const alerts = ["营业额为什么掉了？", "老客户为什么没回来？", "说已经处理，结果在哪里？"];
  return (
    <AbsoluteFill className="story-scene" style={{opacity: sceneOpacity(frame, duration)}}>
      <Film src="stock/opening-laptop.mp4" startFrom={20} darken={0.57} position="center 58%" />
      <Voice file="01-opening" />
      <Brand />
      <SceneHeader number="场景一" title="打烊之后，老板还没有下班" />
      <div className="story-left">
        <div className="time" style={reveal(frame, 14)}>22:30</div>
        <BigLine style={reveal(frame, 25)}>门店打烊了，<br />问题却还没结束。</BigLine>
      </div>
      <div className="message-stack">
        {alerts.map((alert, i) => <div key={alert} style={reveal(frame, 45 + i * 18)}>{alert}</div>)}
      </div>
      <div className="pain-bottom">痛点：数据很多，没人把问题真正追到底。</div>
    </AbsoluteFill>
  );
};

const SceneTwo: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="story-scene" style={{opacity: sceneOpacity(frame, duration)}}>
      <Film src="stock/customer-enters.mp4" startFrom={10} darken={0.5} position="center 35%" />
      <Voice file="02-customer-pain" />
      <Brand />
      <SceneHeader number="场景二" title="一个熟客，47天没有再来" />
      <div className="customer-record" style={reveal(frame, 24)}>
        <small>顾客档案</small>
        <strong>林女士</strong>
        <div><span>累计到店</span><b>8次</b></div>
        <div><span>累计消费</span><b>¥2,860</b></div>
        <div className="danger"><span>距上次到店</span><b>47天</b></div>
      </div>
      <div className="nobody" style={reveal(frame, 64)}>
        <span>问题不是没有会员名单</span>
        <strong>而是没人知道：谁正在流失</strong>
      </div>
      <div className="pain-bottom">痛点：等老板想起这个熟客时，维护机会可能已经错过。</div>
    </AbsoluteFill>
  );
};

const SceneThree: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="light-scene" style={{opacity: sceneOpacity(frame, duration)}}>
      <Voice file="03-customer-solution" />
      <Brand />
      <SceneHeader number="场景三" title="系统先找到她，再帮助门店接住她" />
      <div className="solution-grid">
        <div className="ui-evidence" style={reveal(frame, 15)}>
          <Img src={staticFile("assets/campaign-full.png")} />
          <div className="ui-focus">重点客户 · 临界流失</div>
        </div>
        <div className="solution-arrow" style={reveal(frame, 50)}>→</div>
        <div className="arrival-phone" style={reveal(frame, 70)}>
          <small>熟客到店提醒</small>
          <strong>林女士再次到店</strong>
          <p>A08桌 · 3位</p>
          <div>上次偏好：清淡、靠窗</div>
          <div>建议动作：主动称呼 + 避开忌口</div>
        </div>
      </div>
      <Sequence from={130} durationInFrames={duration - 130}>
        <div className="service-insert">
          <Video src={staticFile("stock/calling-waiter.mp4")} trimBefore={35} muted loop objectFit="cover" />
          <div><small>现场变化</small><strong>员工知道客人是谁，也知道该怎么接待</strong></div>
        </div>
      </Sequence>
      <div className="solution-bottom">解决方案：重点客户池 → 个性化维护 → 到店识别 → 有温度的接待</div>
    </AbsoluteFill>
  );
};

const SceneFour: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const chain = ["客户", "触达", "优惠券", "回店", "订单", "实收"];
  return (
    <AbsoluteFill className="story-scene attribution" style={{opacity: sceneOpacity(frame, duration)}}>
      <Film src="stock/restaurant-guests.mp4" startFrom={20} darken={0.75} />
      <Voice file="04-attribution" />
      <Brand />
      <SceneHeader number="场景四" title="发出去不是结果，回来的订单才是" />
      <BigLine style={{...reveal(frame, 18), maxWidth: 1100}}>这次维护，<br />到底有没有带来生意？</BigLine>
      <div className="chain">
        {chain.map((item, i) => <React.Fragment key={item}><div style={reveal(frame, 55 + i * 10)}>{item}</div>{i < chain.length - 1 && <span>→</span>}</React.Fragment>)}
      </div>
      <div className="proof-row">
        <div style={reveal(frame, 120)}><strong>26</strong><span>回店客户</span></div>
        <div style={reveal(frame, 136)}><strong>26</strong><span>真实订单</span></div>
        <div style={reveal(frame, 152)}><strong>¥4,660.51</strong><span>归因实收</span></div>
        <div className="gold" style={reveal(frame, 168)}><strong>5.37倍</strong><span>综合营销投入产出比</span></div>
      </div>
      <div className="legal-note">现有系统单次营销归因示例，不承诺固定营业额增长。</div>
      <div className="solution-bottom dark-strip">解决方案：每一次维护，都能追到客户、活动、优惠券与真实订单。</div>
    </AbsoluteFill>
  );
};

const SceneFive: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const issues = ["晚市营业额连续下滑", "招牌菜差评增加", "任务三天无人回复"];
  return (
    <AbsoluteFill className="story-scene" style={{opacity: sceneOpacity(frame, duration)}}>
      <Film src="stock/kitchen-work.mp4" startFrom={15} darken={0.64} />
      <Voice file="05-operations-pain" />
      <Brand />
      <SceneHeader number="场景五" title="问题说了很多次，却一直反复" />
      <div className="issue-list">
        {issues.map((item, i) => <div key={item} style={reveal(frame, 25 + i * 22)}><span>异常 0{i + 1}</span><strong>{item}</strong><b>未闭环</b></div>)}
      </div>
      <div className="group-reply" style={reveal(frame, 105)}>
        <small>店长回复</small>
        <strong>“已经让他们注意了。”</strong>
        <p>没有责任人 · 没有截止时间 · 没有验证标准</p>
      </div>
      <div className="pain-bottom">痛点：老板不在店里，管理又回到靠群消息、靠人盯。</div>
    </AbsoluteFill>
  );
};

const SceneSix: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [105, 245], [8, 100], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return (
    <AbsoluteFill className="light-scene" style={{opacity: sceneOpacity(frame, duration)}}>
      <Voice file="06-operations-solution" />
      <Brand />
      <SceneHeader number="场景六" title="把经营问题，变成有人负责的动作" />
      <div className="operations-grid">
        <div className="diagnosis-window" style={reveal(frame, 15)}>
          <Img src={staticFile("assets/diagnosis-card-overview.jpg")} />
          <div className="diagnosis-tag">AI发现：晚市转化异常</div>
        </div>
        <div className="task-window" style={reveal(frame, 64)}>
          <small>整改任务 #GR-20260722</small>
          <h3>优化晚市重点菜品推荐与现场转化</h3>
          <div><span>责任人</span><b>门店店长</b></div>
          <div><span>截止时间</span><b>今日 17:00</b></div>
          <div><span>验证标准</span><b>上传现场执行结果</b></div>
          <div className="progress"><i style={{width: `${progress}%`}} /></div>
          <strong className="status">{progress >= 99 ? "已完成 · 待复盘" : "执行中"}</strong>
        </div>
      </div>
      <div className="process-line">
        {['发现问题','分析原因','拆成任务','责任到人','审核结果'].map((s, i) => <div key={s} style={reveal(frame, 118 + i * 12)}><span>{i + 1}</span>{s}</div>)}
      </div>
      <div className="solution-bottom">解决方案：不是一句“已经处理”，而是清楚看到谁在做、做到哪、结果有没有改变。</div>
    </AbsoluteFill>
  );
};

const SceneSeven: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const standards = ["关键动作逐项打点", "上传照片或视频", "上级复核", "形成岗位能力记录"];
  return (
    <AbsoluteFill className="story-scene" style={{opacity: sceneOpacity(frame, duration)}}>
      <Film src="stock/serving-appetizers.mp4" startFrom={30} darken={0.59} position="center 45%" />
      <Voice file="07-people" />
      <Brand />
      <SceneHeader number="场景七" title="标准不是贴在墙上，而是每天被执行" />
      <div className="standard-panel">
        <small>出品打点卡 · 招牌菜</small>
        <h2>员工会做，才是真标准</h2>
        {standards.map((s, i) => <div key={s} style={reveal(frame, 35 + i * 18)}><b>✓</b>{s}</div>)}
      </div>
      <div className="ability-panel" style={reveal(frame, 125)}>
        <span>真实表现沉淀</span>
        <div>任务完成 <b>92%</b></div>
        <div>培训认证 <b>6项</b></div>
        <div>服务积分 <b>1,280</b></div>
        <strong>适合培养：店长储备</strong>
      </div>
      <div className="solution-bottom dark-strip">解决方案：实操打点 → 培训考试 → 认证成长 → 积分与晋升依据</div>
    </AbsoluteFill>
  );
};

const SceneEight: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="closing-scene" style={{opacity: sceneOpacity(frame, duration)}}>
      <Voice file="08-closing" />
      <Brand />
      <div className="closing-main">
        <span style={reveal(frame, 18)}>一个老板的一天，终于不再从救火开始</span>
        <BigLine style={reveal(frame, 34)}>把来过的客户找回来，<br />把人和经营真正管起来。</BigLine>
        <div className="delivery-proof">
          <div style={reveal(frame, 70)}><small>01</small><strong>AI增长系统</strong><p>工具底座</p></div>
          <div style={reveal(frame, 88)}><small>02</small><strong>增长服务陪跑</strong><p>持续帮跑</p></div>
          <div style={reveal(frame, 106)}><small>03</small><strong>结果证明</strong><p>效果可见</p></div>
        </div>
        <div className="thirty-days" style={reveal(frame, 145)}>
          <small>不用先相信全部</small>
          <strong>用30天，先验证最关键的经营闭环</strong>
          <div>申请门店数据诊断</div><div className="primary">申请30天付费试跑</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const scenes = [
  [SceneOne, 510],
  [SceneTwo, 450],
  [SceneThree, 540],
  [SceneFour, 610],
  [SceneFive, 480],
  [SceneSix, 590],
  [SceneSeven, 590],
  [SceneEight, 540],
] as const;

const Sfx = () => (
  <>
    {[510, 960, 1500, 2110, 2590, 3180, 3770].map((from) => (
      <Sequence key={from} from={from} durationInFrames={30}>
        <Audio src={staticFile("audio/whoosh.wav")} volume={0.16} />
      </Sequence>
    ))}
    <Sequence from={1130} durationInFrames={45}><Audio src={staticFile("audio/ding.wav")} volume={0.28} /></Sequence>
    <Sequence from={2890} durationInFrames={30}><Audio src={staticFile("audio/click.wav")} volume={0.22} /></Sequence>
  </>
);

export const StoryFilm: React.FC = () => {
  let start = 0;
  return (
    <AbsoluteFill style={{backgroundColor: INK}}>
      <Audio src={staticFile("audio/underscore.mp3")} volume={0.28} />
      <Sfx />
      {scenes.map(([Scene, duration], index) => {
        const from = start;
        start += duration;
        return (
          <Sequence key={index} from={from} durationInFrames={duration} premountFor={FPS}>
            <Scene duration={duration} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const MyComposition = () => (
  <Composition
    id="RestaurantAIGrowthStory"
    component={StoryFilm}
    durationInFrames={4310}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
