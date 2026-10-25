# Seedance 2.5 native audio A/B

同一张本地生成的参考图、同一段 8.1 秒自生成 TTS 音色参考、4 秒 480p；只改台词。

| 镜头 | 台词 | task | 耗时 | cost | 产物 |
|---|---|---|---|---|---|
| shot1 | 你好，今天天气不错。 | task_01M5PQAJXXE8T2NJXPTS9X4QBZ | 157s | 0.3883 | shot1.mp4 |
| shot2 | 我会尽快回来。 | task_01M5PQFSX2RGGBYHDNGHSFNK2A | 162s | 0.3883 | shot2.mp4 |
| shot3 | 今天的天气很好。 | task_01M5PQT2S261HVT65BS2AC6YZK | 152s | 0.3883 | shot3.mp4 |

机器检查：

- 三个成片都是 854x480、H.264、AAC 32kHz stereo、4.064s。
- 每个只有一条音轨；没有叠加 TTS 的第二层人声。
- 总成功成本 1.1649；两次内容安全失败 cost 0：
  - `task_01M5PQ431S0JX49YQQR2AB30E9`：外部参考图 + audio_url
  - `task_01M5PQN5FAPD1A46K6A6SN0GK2`：台词“别担心，我没事。”

需要人工听/看：

- 三条声音是否像同一个角色；跨镜音色是否稳定。
- 嘴型是否和台词自然对应。
- 哪条最接近参考 TTS 的音色。

自动化只能确认“单 audio_url 请求成功、成片有单音轨、时长/分辨率正确”，不能替代主观听感。
