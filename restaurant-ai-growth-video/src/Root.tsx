import "./index.css";
import "./v3.css";
import { MyComposition } from "./Composition";
import { V4Composition } from "./CompositionV3";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <V4Composition />
    </>
  );
};
