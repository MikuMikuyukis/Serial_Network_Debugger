import { createApp } from "vue";
import App from "./App.vue";
import { applyTheme, loadTheme } from "./storage";
import "./styles.css";

applyTheme(loadTheme());
createApp(App).mount("#app");
