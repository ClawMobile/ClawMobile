# ClawMobile Demo Gallery

This page keeps additional ClawMobile demos outside the README so the project
front page can stay focused on the Android app and first-run setup flow.

## Mobile Skill Demo

Teach ClawMobile by doing the task once on the phone. It records the
demonstration, turns the trace into a reusable OpenClaw skill, and can run that
skill later from a natural-language request.

The screenshots below use Telegram as one supported command channel. The
Android app is now the recommended first control surface for setup, runtime
status, tasks, skills, and trusted-agent messaging.

<table>
  <tr>
    <td align="center">
      <img src="../assets/skill-demo-capabilities.jpg" width="240" alt="ClawMobile listing available skills in Telegram" />
    </td>
    <td align="center">
      <img src="../assets/skill-demo-recording-start.jpg" width="240" alt="ClawMobile starts recording a Google Keep note demonstration" />
    </td>
    <td align="center">
      <img src="../assets/skill-demo-created.jpg" width="240" alt="ClawMobile creates a reusable Google Keep note skill" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Ask what it can do</strong></td>
    <td align="center"><strong>Demonstrate once</strong></td>
    <td align="center"><strong>Reuse as a skill</strong></td>
  </tr>
</table>

<table align="center">
  <tr>
    <td align="center" width="420">
      <strong>Generated Google Keep skill</strong><br>
      <video src="https://github.com/user-attachments/assets/7fbeb919-b5fa-48f3-aacb-c64f0132a909" controls width="360"></video>
    </td>
  </tr>
</table>

## How Skill Learning Works

ClawMobile turns a one-time phone demonstration into a reusable workflow:

1. Record the task as the user performs it.
2. Capture touch events, screenshots, app state, and UI evidence.
3. Generate a parameterized skill candidate.
4. Promote the candidate into the OpenClaw workspace.
5. Reuse it, test it, and improve it with feedback or another demo.

The goal is not to hard-code every app. It is to give the agent durable local
evidence: what the user did, what screen state mattered, what values should be
parameters, and where recovery may be needed. Over time, generated skills can
accumulate execution feedback and additional demonstrations instead of relying
only on one-off screenshot reasoning.

This is especially useful for mobile apps where pure screenshot-based agents can
mis-click, lose context, or repeat expensive verification loops.

Generated skills are a **public-preview** capability. The core flow can record a
demo, generate a reusable skill, promote it into the OpenClaw workspace, and use
later execution feedback as attached evidence. Reliability improves with
additional demonstrations, cleaner starting app states, and feedback from real
executions. Fast paths and batch execution are experimental accelerators for
stable generated-skill steps, not a replacement for normal recovery.

## Additional Demos

<table align="center">
  <tr>
    <td align="center" width="320">
      <strong>Hardware demo</strong><br>
      <video src="https://github.com/user-attachments/assets/98f4eb0c-57a4-4ee6-aa18-06b7b721e41c" controls width="300"></video>
    </td>
    <td align="center" width="320">
      <strong>System demo</strong><br>
      <video src="https://github.com/user-attachments/assets/56ea6594-4cca-4e5c-9421-6ee195ac608b" controls width="300"></video>
    </td>
    <td align="center" width="320">
      <strong>Script demo</strong><br>
      <video src="https://github.com/user-attachments/assets/3d04f10e-c64e-4298-a78e-d2e3c3d106f3" controls width="300"></video>
    </td>
  </tr>
  <tr>
    <td align="center" width="320">
      <strong>Chrome demo</strong><br>
      <video src="https://github.com/user-attachments/assets/5a54672b-86fe-4f79-aa05-063a4e12453d" controls width="300"></video>
    </td>
    <td align="center" width="320">
      <strong>Maps demo</strong><br>
      <video src="https://github.com/user-attachments/assets/778b64e7-d524-433d-a81c-c3b13cc0799d" controls width="300"></video>
    </td>
    <td align="center" width="320">
      <strong>Icecream demo</strong><br>
      <video src="https://github.com/user-attachments/assets/afe9d09d-4f61-4243-95d0-5ff14699dd66" controls width="300"></video>
    </td>
  </tr>
</table>
