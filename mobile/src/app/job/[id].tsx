import { useLocalSearchParams } from "expo-router";
import App from "../../../App";
export default function Opportunity() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <App selectedId={id} />;
}
