# Spec Delta

## Purpose

允许用户为剧本、角色、镜头表、提示词四个生成环节分别绑定模型，并在工作台里手动覆盖；系统按用户选择调用模型，不静默替换。

## ADDED Requirements

### Requirement: Stage model bindings

The system SHALL let users bind one configured text-capable model to each of the script, character, shot, and prompt stages in settings. A binding MUST reference a model entry whose capability is text or textPro. An unset binding means the stage uses the configured general text default.

#### Scenario: Bind a model to a stage

- **WHEN** user selects a text model for the 剧本 stage in settings and saves
- **THEN** the binding persists and is returned when settings are reloaded

#### Scenario: Unset binding falls back to the text default

- **WHEN** a stage has no binding and the general text default is configured
- **THEN** the stage resolves to that text default

#### Scenario: Non-text models are not offered

- **WHEN** user opens a stage model binding dropdown
- **THEN** only model entries with text or textPro capability are listed

### Requirement: Workbench model selector

Each of the script, shot, and prompt workbenches SHALL show a model selector listing all text-capable models plus a default option. The default option MUST display the resolved stage model. A manual choice SHALL override the stage binding for that stage and persist across reloads.

#### Scenario: Default option shows resolved model

- **WHEN** a stage binding exists
- **THEN** the selector's default option displays that model's label and model ID

#### Scenario: Manual override is used and remembered

- **WHEN** user chooses a non-default model in a workbench and generates
- **THEN** the request uses that model, and the same choice is selected after a page reload

#### Scenario: Layout generation follows the shot stage

- **WHEN** 3D layout generation runs for a shot
- **THEN** it uses the resolved model of the 镜头表 stage

### Requirement: Explicit model choice is authoritative

When a generation request includes a model key, the system MUST use the model entry with that exact key if it is text-capable. If the key is unknown or not text-capable, the request MUST fail with a readable error naming the key; the system MUST NOT silently substitute another model.

#### Scenario: textPro model key resolves

- **WHEN** a request supplies the key of a textPro model entry
- **THEN** the system calls that entry's model instead of the text default

#### Scenario: Unknown model key is rejected

- **WHEN** a request supplies a model key that does not exist or is not text-capable
- **THEN** the request fails with an error that names the key, and no model is called

### Requirement: Character stage covers extraction and three-view

The character stage SHALL provide separate model choices for text extraction and three-view image generation. Extraction SHALL use the character stage text model; the three-view selector SHALL list view-capable models and use the selected entry, falling back to the configured view default when unset.

#### Scenario: Extraction uses the character stage model

- **WHEN** user runs 拆角色
- **THEN** the request uses the character stage's resolved text model

#### Scenario: Three-view model can be chosen

- **WHEN** user selects a view model in the character board and generates a turnaround
- **THEN** the request uses that view model, and the choice persists across reloads

### Requirement: Actual model is reported

Every text generation response SHALL report the resolved model key and model ID. The stage UI SHALL surface that model so the user can confirm which model produced the result.

#### Scenario: Response reports resolved model

- **WHEN** a text generation completes successfully
- **THEN** the response includes the model key and model ID that were called

#### Scenario: UI shows the actual model

- **WHEN** a stage generation completes
- **THEN** the stage feedback names the model that ran

### Requirement: No built-in stage model fallback

All stage models SHALL be resolved from user configuration. If neither a stage binding nor a general text default resolves to an available text-capable model, generation MUST fail with a clear configuration error instead of using a built-in model identifier.

#### Scenario: No text model configured

- **WHEN** no text-capable model is available or the general text default is missing
- **THEN** stage generation is blocked with a message asking the user to configure a model
