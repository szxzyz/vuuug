---
name: Admin settings key convention
description: snake_case is canonical for admin_settings; camelCase aliases exist but reads must use snake_case
---

The `admin_settings` table stores keys in snake_case (`channel_task_reward`, `bot_task_reward`, `partner_task_reward`).
The PUT `/api/admin/settings` handler saves both camelCase and snake_case for backwards compat, but all reads must use snake_case.

**Why:** The home task reward reads at routes.ts were using camelCase keys (`channelTaskReward`) so admin changes to those rewards never took effect — the reads always fell back to defaults.

**How to apply:** Whenever reading an app setting, use the snake_case form. Search for `getAppSetting` calls with camelCase arguments and fix them.
