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

const sceneFrames = [904, 1022, 1146, 1212, 1042, 976, 953, 941, 1102, 1013, 495] as const;

const totalFrames = sceneFrames.reduce((sum, value) => sum + value, 0);

type SceneProps = {duration: number};

const enter = (frame: number, at: number, distance = 34) => ({
  opacity: interpolate(frame, [at, at + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }),
  translate: `0 ${interpolate(frame, [at, at + 24], [distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })}px`,
});

const fadeScene = (frame: number, duration: number) =>
  interpolate(frame, [0, 12, duration - 15, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const Film: React.FC<{src: string; dark?: number; position?: string; trim?: number}> = ({
  src,
  dark = 0.58,
  position = "center",
  trim = 0,
}) => (
  <AbsoluteFill>
    <Video
      src={staticFile(src)}
      trimBefore={trim}
      muted
      loop
      objectFit="cover"
      style={{width: "100%", height: "100%", objectPosition: position}}
    />
    <AbsoluteFill style={{background: `linear-gradient(90deg, rgba(5,10,11,${dark + 0.12}), rgba(5,10,11,${dark}))`}} />
  </AbsoluteFill>
);

const Voice: React.FC<{file: string}> = ({file}) => (
  <Audio src={staticFile(`audio-v4/${file}.mp3`)} volume={1} />
);

const SceneTop: React.FC<{number: string; chapter: string; demo?: boolean}> = ({number, chapter, demo}) => (
  <div className="v3-top">
    <div className="v3-brand"><span>餐厅AI增长服务</span><small>上海年年有喜科技有限公司</small></div>
    <div className="v3-chapter"><span>{number}</span>{chapter}{demo && <em>场景演示</em>}</div>
  </div>
);

const ResultBar: React.FC<{children: React.ReactNode; tone?: "gold" | "green"}> = ({children, tone = "gold"}) => (
  <div className={`v3-result-bar ${tone}`}>结果：{children}</div>
);

const Screenshot: React.FC<{src: string; label: string; fit?: "cover" | "contain"; position?: string}> = ({
  src,
  label,
  fit = "cover",
  position = "top",
}) => (
  <div className="v3-screen">
    <div className="v3-browser-dots"><i /><i /><i /><span>真实系统界面 · 已脱敏</span></div>
    <Img src={staticFile(src)} style={{objectFit: fit, objectPosition: position}} />
    <b>{label}</b>
  </div>
);

const Scene01: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const outcomes = ["客户回店，金额可核对", "经营问题，有复盘结论", "厨房标准，每天被执行", "员工贡献，有评价依据", "主动多做，能够被看见", "一线经验，可以被复制"];
  return (
    <AbsoluteFill className="v3-scene dark" style={{opacity: fadeScene(frame, duration)}}>
      <Film src="stock/opening-laptop.mp4" trim={20} dark={0.56} position="center 58%" />
      <Voice file="01-day-30" />
      <SceneTop number="第30天" chapter="陈总使用AI增长服务" demo />
      <div className="v3-hero-left">
        <div className="v3-kicker" style={enter(frame, 18)}>先看结果</div>
        <h1 style={enter(frame, 28)}>六个经营结果，<br /><strong>开始变得清楚</strong></h1>
        <p style={enter(frame, 55)}>陈总不再追着所有人问过程，而是直接看结果、做决策。</p>
      </div>
      <div className="v3-outcome-stack">
        {outcomes.map((item, index) => (
          <div key={item} style={enter(frame, 55 + index * 28)}><span>0{index + 1}</span>{item}<b>✓</b></div>
        ))}
      </div>
      <ResultBar>使用服务的第30天：从追过程，回到看结果、做决策</ResultBar>
    </AbsoluteFill>
  );
};

const Scene03: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const steps = ["识别高价值与流失客户", "给出理由、权益与话术", "触达并等待回店", "到店提醒，个性化接待"];
  return (
    <AbsoluteFill className="v3-scene paper" style={{opacity: fadeScene(frame, duration)}}>
      <Voice file="03-customer-how" />
      <SceneTop number="结果如何产生" chapter="找对人、接住人、算清钱" />
      <div className="v3-split">
        <div className="v3-copy-column">
          <div className="v3-kicker" style={enter(frame, 20)}>客户增长闭环</div>
          <h2 style={enter(frame, 32)}>不是盲目群发，<br /><strong>先找到最值得维护的人</strong></h2>
          <div className="v3-step-list">
            {steps.map((item, index) => <div key={item} style={enter(frame, 70 + index * 26)}><span>{index + 1}</span>{item}</div>)}
          </div>
        </div>
        <div className="v3-evidence-column" style={enter(frame, 48)}>
          <Screenshot src="assets/campaign-full.png" label="客群洞察与客户维护" position="center" />
          <div className="v3-arrival-card" style={enter(frame, 170)}>
            <small>熟客到店提醒</small><strong>L女士再次到店</strong>
            <p>A08桌 · 偏好清淡 · 建议主动称呼</p>
          </div>
        </div>
      </div>
      <ResultBar tone="green">从“会员名单”变成“值得维护、能够接住的客户资产”</ResultBar>
    </AbsoluteFill>
  );
};

const Scene04: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const evidence = ["客户记录", "触达时间", "活动/优惠券", "回店时间", "真实订单", "实收金额"];
  return (
    <AbsoluteFill className="v3-scene dark attribution-v3" style={{opacity: fadeScene(frame, duration)}}>
      <Film src="stock/restaurant-guests.mp4" trim={25} dark={0.78} />
      <Voice file="02-customer-result" />
      <SceneTop number="结果一" chapter="客户回来了，贡献金额算得清" />
      <div className="v3-attribution-title" style={enter(frame, 20)}>
        <small>短期成交最强证据</small>
        <h2>每一次维护，都能追到<strong>真实订单</strong></h2>
      </div>
      <div className="v3-evidence-chain">
        {evidence.map((item, index) => <React.Fragment key={item}><div style={enter(frame, 70 + index * 14)}>{item}</div>{index < evidence.length - 1 && <span>→</span>}</React.Fragment>)}
      </div>
      <div className="v3-number-stage">
        <div style={enter(frame, 150)}><strong>7,757</strong><span>实际触达客户</span></div>
        <div style={enter(frame, 176)}><strong>26</strong><span>回店客户 / 真实订单</span></div>
        <div style={enter(frame, 202)}><strong>¥4,660.51</strong><span>归因实收营业额</span></div>
        <div className="hero-number" style={enter(frame, 228)}><strong>5.37倍</strong><span>综合营销投入产出比</span></div>
      </div>
      <div className="v3-disclaimer">现有系统单次营销归因示例；触达投入产出比12.02倍，计入优惠成本后综合5.37倍。不承诺固定营业额增长。</div>
      <ResultBar>以前只知道发了多少，现在知道谁回来、贡献了多少钱</ResultBar>
    </AbsoluteFill>
  );
};

const Scene05: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const goals = ["营业额", "员工效率", "出品标准", "菜品质量", "菜品毛利率", "复制人才"];
  return (
    <AbsoluteFill className="v3-scene paper" style={{opacity: fadeScene(frame, duration)}}>
      <Voice file="04-operation-result" />
      <SceneTop number="结果二" chapter="经营问题有原因、有责任、有结论" />
      <div className="v3-diagnosis-layout">
        <div className="v3-diagnosis-copy">
          <div className="v3-kicker" style={enter(frame, 18)}>老板的第二大脑</div>
          <h2 style={enter(frame, 30)}>不只看营业额，<br /><strong>持续诊断六个经营目标</strong></h2>
          <div className="v3-goals">
            {goals.map((goal, index) => <div key={goal} style={enter(frame, 68 + index * 18)}><span>0{index + 1}</span>{goal}</div>)}
          </div>
          <div className="v3-cause-card" style={enter(frame, 190)}>
            <small>示例：晚市营业额下滑</small>
            <b>客流 → 转化 → 客单 → 菜品结构 → 员工执行</b>
            <strong>诊断结果 → 责任任务 → 证据复核 → 指标改善</strong>
          </div>
        </div>
        <div className="v3-diagnosis-screen" style={enter(frame, 50)}>
          <Screenshot src="assets/diagnosis-card-overview.jpg" label="经营诊断概览" position="center 16%" />
        </div>
      </div>
      <ResultBar tone="green">不再只知道“掉了”，而是知道“为什么掉、先改什么”</ResultBar>
    </AbsoluteFill>
  );
};

const Scene07: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="v3-scene dark" style={{opacity: fadeScene(frame, duration)}}>
      <Film src="stock/kitchen-work.mp4" trim={80} dark={0.6} position="center 45%" />
      <Voice file="05-kitchen-result" />
      <SceneTop number="结果三" chapter="厨房标准、备货和毛利开始可控" demo />
      <div className="v3-kitchen-layout">
        <div className="v3-standard-card" style={enter(frame, 25)}>
          <small>出品打点卡 · 招牌菜</small><h2>标准不是贴在墙上</h2>
          {['关键动作逐项确认','火候与份量留证','上传照片或视频','上级复核并沉淀能力'].map((item, index) => <div key={item} style={enter(frame, 60 + index * 20)}><b>✓</b>{item}</div>)}
        </div>
        <div className="v3-stock-card" style={enter(frame, 75)}>
          <small>AI智能备货预测</small><h2>明天每道菜备多少？</h2>
          <div className="v3-stock-inputs"><span>历史销售</span><span>天气</span><span>节假日</span><span>星期</span><span>饭市</span><span>堂食/外卖</span></div>
          <div className="v3-stock-output"><i>预测结果</i><strong>分菜品 · 分时段 · 分渠道</strong></div>
        </div>
      </div>
      <div className="v3-three-results">
        {['少一点损耗','少一次沽清','多守住一分毛利'].map((item, index) => <div key={item} style={enter(frame, 200 + index * 25)}>{item}</div>)}
      </div>
      <ResultBar>厨房从“老师傅记得”，变成“每天有人按标准做到”</ResultBar>
    </AbsoluteFill>
  );
};

const Scene08: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const metrics = [["任务完成", "92%"], ["培训认证", "6项"], ["服务表现", "4.8分"], ["销售贡献", "本月前20%"], ["员工积分", "1,280"]];
  return (
    <AbsoluteFill className="v3-scene paper" style={{opacity: fadeScene(frame, duration)}}>
      <Voice file="06-people-result" />
      <SceneTop number="结果四" chapter="奖励、培养、晋升和辅导都有依据" demo />
      <div className="v3-people-layout">
        <div className="v3-profile-card" style={enter(frame, 25)}>
          <div className="v3-avatar">A</div><div><small>员工绩效档案</small><h2>员工A · 前厅服务</h2><p>连续在岗 186天</p></div>
          <strong>店长储备</strong>
        </div>
        <div className="v3-metric-grid">
          {metrics.map(([label, value], index) => <div key={label} style={enter(frame, 65 + index * 22)}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <div className="v3-person-decisions">
          {['谁值得奖励','谁适合培养','谁可以晋升','谁需要辅导'].map((item, index) => <div key={item} style={enter(frame, 190 + index * 20)}>{item}<b>→ 有依据</b></div>)}
        </div>
      </div>
      <ResultBar tone="green">管理不是给员工贴标签，而是把合适的人放在合适的位置</ResultBar>
    </AbsoluteFill>
  );
};

const Scene09: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const points = ["完成整改任务 +80", "获得客户好评 +30", "推荐菜品成交 +20", "通过岗位认证 +100"];
  return (
    <AbsoluteFill className="v3-scene dark motivation-v3" style={{opacity: fadeScene(frame, duration)}}>
      <Film src="stock/serving-appetizers.mp4" trim={35} dark={0.7} />
      <Voice file="07-motivation-result" />
      <SceneTop number="结果五" chapter="员工多做一步，能够被看见" demo />
      <div className="v3-motivation-copy" style={enter(frame, 18)}>
        <div className="v3-kicker">多做一步，被看见</div>
        <h2>花小钱，激活一线员工的<strong>主动性</strong></h2>
      </div>
      <div className="v3-points-panel">
        {points.map((item, index) => <div key={item} style={enter(frame, 60 + index * 25)}><span>{item}</span><b>已入账</b></div>)}
      </div>
      <div className="v3-points-total" style={enter(frame, 180)}><small>本月积分</small><strong>1,280</strong><p>兑换奖励 · 奖金 · 荣誉 · 晋升参考</p></div>
      <div className="v3-motivation-result" style={enter(frame, 230)}>员工知道：认真做事，不会被埋没</div>
      <ResultBar>从“要我做”，变成“我愿意多做一步”</ResultBar>
    </AbsoluteFill>
  );
};

const Scene10: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const flow = ["上传一线经验", "AI整理资料", "自动生成考试", "学习与考试", "上传实操", "AI初判", "上级确认", "认证晋升"];
  return (
    <AbsoluteFill className="v3-scene paper" style={{opacity: fadeScene(frame, duration)}}>
      <Voice file="08-talent-result" />
      <SceneTop number="结果六" chapter="老师傅经验能够复制给新人" demo />
      <div className="v3-talent-title" style={enter(frame, 18)}>
        <small>以前：资料没人整理、没人更新、没人考核</small>
        <h2>现在：每个会做事的人，<strong>都能生产培训内容</strong></h2>
      </div>
      <div className="v3-training-flow">
        {flow.map((item, index) => <div key={item} style={enter(frame, 62 + index * 19)}><span>0{index + 1}</span><strong>{item}</strong></div>)}
      </div>
      <div className="v3-cert-card" style={enter(frame, 225)}>
        <small>岗位认证</small><strong>招牌菜出品认证 · 已通过</strong><p>考试内容严格来自指定培训资料</p>
      </div>
      <ResultBar tone="green">新人上手更快，标准不再跟着老师傅离开</ResultBar>
    </AbsoluteFill>
  );
};

const Scene11: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const day = ["营业结束", "同步数据", "发现异常", "推荐客户池", "生成任务/备货", "员工执行打点", "店长追踪", "老板看结果"];
  return (
    <AbsoluteFill className="v3-scene dark" style={{opacity: fadeScene(frame, duration)}}>
      <Voice file="09-service-running" />
      <SceneTop number="持续运行" chapter="结果不是一次培训或一张报表" />
      <div className="v3-day-title" style={enter(frame, 20)}><h2>老板不在店里，<strong>服务也在盯客户、盯问题、盯人</strong></h2></div>
      <div className="v3-day-timeline">
        {day.map((item, index) => <div key={item} style={enter(frame, 62 + index * 19)}><span>{String(index + 1).padStart(2, "0")}</span><b>{item}</b></div>)}
      </div>
      <div className="v3-ai-proof" style={enter(frame, 220)}>
        <Screenshot src="assets/agents-admin-full.png" label="Agent任务与运行状态" position="center top" />
      </div>
      <div className="v3-service-note" style={enter(frame, 255)}><b>AI持续发现与提醒</b><span>+</span><b>服务团队配置、推动与复盘</b></div>
      <ResultBar>老板只看最终要做的决策，不再被所有过程拖住</ResultBar>
    </AbsoluteFill>
  );
};

const Scene12: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  const changes = [
    ["客户", "谁该维护、谁回来了、贡献了多少钱"],
    ["经营", "问题在哪里、谁负责、结果是否改善"],
    ["员工", "真实表现、奖励培养与辅导依据"],
    ["培训", "经验变成资料、考试与实操认证"],
    ["厨房", "标准、备货、损耗与沽清持续管理"],
  ];
  return (
    <AbsoluteFill className="v3-scene closing-v3" style={{opacity: fadeScene(frame, duration)}}>
      <Voice file="10-company-closing" />
      <SceneTop number="品牌与服务" chapter="专注餐厅AI增长服务" />
      <div className="v3-closing-title" style={enter(frame, 20)}><small>上海年年有喜科技有限公司</small><h2>我们是一家专门提供<br /><strong>餐厅AI增长服务</strong>的公司</h2></div>
      <div className="v3-change-list">
        {changes.map(([label, text], index) => <div key={label} style={enter(frame, 70 + index * 24)}><strong>{label}</strong><span>{text}</span><b>✓</b></div>)}
      </div>
      <div className="v3-delivery">
        <div style={enter(frame, 225)}><small>01</small><strong>AI增长系统</strong><span>工具底座</span></div>
        <div style={enter(frame, 245)}><small>02</small><strong>增长服务陪跑</strong><span>持续帮跑</span></div>
        <div style={enter(frame, 265)}><small>03</small><strong>结果证明</strong><span>效果可见</span></div>
      </div>
      <div className="v3-cta" style={enter(frame, 315)}><div><small>不用先相信全部</small><strong>用30天，先验证最关键的经营闭环</strong></div><span>申请门店数据诊断</span><b>申请30天付费试跑</b></div>
      <div className="v3-final-line">上海年年有喜科技有限公司 · 把来过的客户找回来，把人和经营真正管起来</div>
    </AbsoluteFill>
  );
};

const Scene13: React.FC<SceneProps> = ({duration}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="v3-scene v3-contact-scene" style={{opacity: fadeScene(frame, duration)}}>
      <Voice file="11-wecom-contact" />
      <SceneTop number="联系我们" chapter="企业微信咨询" />
      <div className="v3-contact-layout">
        <div className="v3-contact-copy" style={enter(frame, 18)}>
          <div className="v3-kicker">了解更多</div>
          <h2>如有任何咨询，<br /><strong>欢迎添加企业微信</strong></h2>
          <p>了解餐厅AI增长服务、门店经营诊断与30天付费试跑方案。</p>
          <div><span>01</span>客户增长与营销归因</div>
          <div><span>02</span>经营诊断与任务闭环</div>
          <div><span>03</span>员工积极性与人才复制</div>
        </div>
        <div className="v3-contact-qr-card" style={enter(frame, 48, 22)}>
          <Img src={staticFile("assets/wecom-qr.png")} />
          <strong>扫码添加企业微信</strong>
          <span>咨询餐厅AI增长服务</span>
        </div>
      </div>
      <div className="v3-contact-footer">上海年年有喜科技有限公司 · 专门提供餐厅AI增长服务</div>
    </AbsoluteFill>
  );
};

const sceneComponents = [Scene01, Scene04, Scene03, Scene05, Scene07, Scene08, Scene09, Scene10, Scene11, Scene12, Scene13];

export const GrowthStoryV4: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{backgroundColor: "#081011"}}>
      <Audio
        src={staticFile("audio-v4/music-bed.mp3")}
        loop
        loopVolumeCurveBehavior="extend"
        volume={(frame) => interpolate(frame, [0, 90, totalFrames - 120, totalFrames], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })}
      />
      {sceneComponents.map((Scene, index) => {
        const duration = sceneFrames[index];
        const start = from;
        from += duration;
        return (
          <Sequence key={index} from={start} durationInFrames={duration} premountFor={FPS}>
            <Scene duration={duration} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const V4Composition = () => (
  <Composition
    id="RestaurantAIGrowthStoryV5"
    component={GrowthStoryV4}
    durationInFrames={totalFrames}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
