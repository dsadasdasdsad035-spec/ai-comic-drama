# Spec Delta

## ADDED Requirements

### Requirement: 卡头出图与 Inspector 出图设置一致

分镜卡卡头出图快捷入口 MUST 使用与 Inspector 画面 Tab 相同的提示词与全局出图设置；MUST NOT 在出片模式下作为出图主入口显示（禁用并提示切换出图模式）。

#### Scenario: 出图模式卡头可用

- **WHEN** 画布处于出图模式
- **THEN** 卡头生成可点击并触发与 Inspector 出图设置一致的出图

#### Scenario: 出片模式弱化卡头出图

- **WHEN** 画布处于出片模式
- **THEN** 卡头不引导静帧生成（隐藏或禁用）
