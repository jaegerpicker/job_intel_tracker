// Never render callback query strings. LiveShell handles and validates the return.
import { Redirect } from "expo-router";
export default function NativeReturn() {
  return <Redirect href="/" />;
}
