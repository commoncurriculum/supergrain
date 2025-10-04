import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import React from 'react'
import { createStore, effect, computed } from '@supergrain/core'
import { useTrackedStore } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('Deep Nesting Operations in React Components', () => {
  beforeEach(() => {
    cleanup()
  })
  // Helper functions for type-safe access to deeply nested properties
  const getDept = (state: any, index: number) =>
    state.organization.departments[index]!
  const getTeam = (state: any, deptIndex: number, teamIndex: number) =>
    getDept(state, deptIndex).teams[teamIndex]!
  const getMember = (
    state: any,
    deptIndex: number,
    teamIndex: number,
    memberIndex: number
  ) => getTeam(state, deptIndex, teamIndex).members[memberIndex]!
  const getProject = (
    state: any,
    deptIndex: number,
    teamIndex: number,
    memberIndex: number,
    projectIndex: number
  ) =>
    getMember(state, deptIndex, teamIndex, memberIndex).projects[projectIndex]!
  const getTask = (
    state: any,
    deptIndex: number,
    teamIndex: number,
    memberIndex: number,
    projectIndex: number,
    taskIndex: number
  ) =>
    getProject(state, deptIndex, teamIndex, memberIndex, projectIndex).tasks[
      taskIndex
    ]!

  // Complex nested data structure for comprehensive testing
  const createComplexStore = () => {
    const [state, update] = createStore({
      organization: {
        id: 'org-1',
        name: 'TechCorp',
        departments: [
          {
            id: 'dept-1',
            name: 'Engineering',
            budget: 500000,
            teams: [
              {
                id: 'team-1',
                name: 'Backend Team',
                members: [
                  {
                    id: 'emp-1',
                    name: 'Alice Johnson',
                    role: 'Senior Developer',
                    skills: ['Node.js', 'PostgreSQL', 'Docker'],
                    projects: [
                      {
                        id: 'proj-1',
                        name: 'API Redesign',
                        status: 'active',
                        tasks: [
                          {
                            id: 'task-1',
                            title: 'Database Migration',
                            completed: false,
                          },
                          {
                            id: 'task-2',
                            title: 'API Documentation',
                            completed: true,
                          },
                        ],
                        metrics: {
                          progress: 0.6,
                          hoursSpent: 45.5,
                          estimatedHours: 80,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    return { state, update }
  }

  // React components for testing deep nesting display
  function TaskComponent({
    state,
    deptIndex,
    teamIndex,
    memberIndex,
    projectIndex,
    taskIndex,
  }: any) {
    const task = getTask(
      state,
      deptIndex,
      teamIndex,
      memberIndex,
      projectIndex,
      taskIndex
    )
    return (
      <div data-testid={`task-${task.id}`}>
        <span data-testid={`task-title-${task.id}`}>{task.title}</span>
        <span data-testid={`task-completed-${task.id}`}>
          {task.completed.toString()}
        </span>
      </div>
    )
  }

  function ProjectComponent({
    state,
    deptIndex,
    teamIndex,
    memberIndex,
    projectIndex,
  }: any) {
    const project = getProject(
      state,
      deptIndex,
      teamIndex,
      memberIndex,
      projectIndex
    )
    return (
      <div data-testid={`project-${project.id}`}>
        <h4 data-testid={`project-name-${project.id}`}>{project.name}</h4>
        <span data-testid={`project-status-${project.id}`}>
          {project.status}
        </span>
        <span data-testid={`project-progress-${project.id}`}>
          {project.metrics.progress}
        </span>
        {project.tasks.map((_: any, taskIndex: number) => (
          <TaskComponent
            key={taskIndex}
            state={state}
            deptIndex={deptIndex}
            teamIndex={teamIndex}
            memberIndex={memberIndex}
            projectIndex={projectIndex}
            taskIndex={taskIndex}
          />
        ))}
      </div>
    )
  }

  function MemberComponent({ state, deptIndex, teamIndex, memberIndex }: any) {
    const member = getMember(state, deptIndex, teamIndex, memberIndex)
    return (
      <div data-testid={`member-${member.id}`}>
        <h3 data-testid={`member-name-${member.id}`}>{member.name}</h3>
        <span data-testid={`member-role-${member.id}`}>{member.role}</span>
        <div data-testid={`member-skills-${member.id}`}>
          {member.skills.join(', ')}
        </div>
        {member.projects.map((_: any, projectIndex: number) => (
          <ProjectComponent
            key={projectIndex}
            state={state}
            deptIndex={deptIndex}
            teamIndex={teamIndex}
            memberIndex={memberIndex}
            projectIndex={projectIndex}
          />
        ))}
      </div>
    )
  }

  function TeamComponent({ state, deptIndex, teamIndex }: any) {
    const team = getTeam(state, deptIndex, teamIndex)
    return (
      <div data-testid={`team-${team.id}`}>
        <h2 data-testid={`team-name-${team.id}`}>{team.name}</h2>
        {team.members.map((_: any, memberIndex: number) => (
          <MemberComponent
            key={memberIndex}
            state={state}
            deptIndex={deptIndex}
            teamIndex={teamIndex}
            memberIndex={memberIndex}
          />
        ))}
      </div>
    )
  }

  function DepartmentComponent({ state, deptIndex }: any) {
    const dept = getDept(state, deptIndex)
    return (
      <div data-testid={`dept-${dept.id}`}>
        <h1 data-testid={`dept-name-${dept.id}`}>{dept.name}</h1>
        <span data-testid={`dept-budget-${dept.id}`}>{dept.budget}</span>
        {dept.teams.map((_: any, teamIndex: number) => (
          <TeamComponent
            key={teamIndex}
            state={state}
            deptIndex={deptIndex}
            teamIndex={teamIndex}
          />
        ))}
      </div>
    )
  }

  function OrganizationComponent({ store }: any) {
    const state = useTrackedStore(store)
    return (
      <div data-testid={`org-${state.organization.id}`}>
        <h1 data-testid={`org-name-${state.organization.id}`}>
          {state.organization.name}
        </h1>
        {state.organization.departments.map((_: any, deptIndex: number) => (
          <DepartmentComponent
            key={deptIndex}
            state={state}
            deptIndex={deptIndex}
          />
        ))}
      </div>
    )
  }

  it('should display deeply nested organizational data in React components', async () => {
    const { state, update } = createComplexStore()

    const { container } = render(<OrganizationComponent store={state} />)

    // Test initial rendering of deeply nested data
    expect(
      container.querySelector('[data-testid="org-name-org-1"]')!.textContent
    ).toBe('TechCorp')
    expect(
      container.querySelector('[data-testid="dept-name-dept-1"]')!.textContent
    ).toBe('Engineering')
    expect(
      container.querySelector('[data-testid="team-name-team-1"]')!.textContent
    ).toBe('Backend Team')
    expect(
      container.querySelector('[data-testid="member-name-emp-1"]')!.textContent
    ).toBe('Alice Johnson')
    expect(
      container.querySelector('[data-testid="project-name-proj-1"]')!
        .textContent
    ).toBe('API Redesign')
    expect(
      container.querySelector('[data-testid="task-title-task-1"]')!.textContent
    ).toBe('Database Migration')
  })

  it('should update React components when deeply nested fields change', async () => {
    const { state, update } = createComplexStore()

    const { container } = render(<OrganizationComponent store={state} />)

    // Update a deeply nested task title
    await act(async () => {
      update({
        $set: {
          'organization.departments.0.teams.0.members.0.projects.0.tasks.0.title':
            'Database Refactoring',
        },
      })
      await flushMicrotasks()
    })

    expect(
      container.querySelector('[data-testid="task-title-task-1"]')!.textContent
    ).toBe('Database Refactoring')
  })

  it('should update React components when nested objects are created', async () => {
    const { state, update } = createComplexStore()

    const { container } = render(<OrganizationComponent store={state} />)

    // Add a new task to existing project
    await act(async () => {
      update({
        $push: {
          'organization.departments.0.teams.0.members.0.projects.0.tasks': {
            id: 'task-3',
            title: 'Performance Testing',
            completed: false,
          },
        },
      })
      await flushMicrotasks()
    })

    expect(
      container.querySelector('[data-testid="task-title-task-3"]')!.textContent
    ).toBe('Performance Testing')
    expect(
      container.querySelector('[data-testid="task-completed-task-3"]')!
        .textContent
    ).toBe('false')
  })

  it('should update React components when nested arrays are reordered', async () => {
    const { state, update } = createComplexStore()

    const { container } = render(<OrganizationComponent store={state} />)

    // First add another task so we have something to reorder
    await act(async () => {
      update({
        $push: {
          'organization.departments.0.teams.0.members.0.projects.0.tasks': {
            id: 'task-3',
            title: 'Performance Testing',
            completed: false,
          },
        },
      })
      await flushMicrotasks()
    })

    // Now reorder tasks
    await act(async () => {
      const currentTasks = getProject(state, 0, 0, 0, 0).tasks
      const reorderedTasks = [currentTasks[2], currentTasks[0], currentTasks[1]]
      update({
        $set: {
          'organization.departments.0.teams.0.members.0.projects.0.tasks':
            reorderedTasks,
        },
      })
      await flushMicrotasks()
    })

    // Check that tasks are now in new order
    const taskElements = Array.from(
      container.querySelectorAll('[data-testid^="task-task-"]')
    )
    expect(taskElements[0].getAttribute('data-testid')).toBe('task-task-3')
    expect(taskElements[1].getAttribute('data-testid')).toBe('task-task-1')
    expect(taskElements[2].getAttribute('data-testid')).toBe('task-task-2')
  })

  it('should update React components when deeply nested metrics change', async () => {
    const { state, update } = createComplexStore()

    const { container } = render(<OrganizationComponent store={state} />)

    // Update project progress
    await act(async () => {
      update({
        $set: {
          'organization.departments.0.teams.0.members.0.projects.0.metrics.progress': 0.85,
        },
      })
      await flushMicrotasks()
    })

    expect(
      container.querySelector('[data-testid="project-progress-proj-1"]')!
        .textContent
    ).toBe('0.85')
  })

  it('should handle adding new departments and teams in React', async () => {
    const { state, update } = createComplexStore()

    const { container } = render(<OrganizationComponent store={state} />)

    // Add a new department
    await act(async () => {
      update({
        $push: {
          'organization.departments': {
            id: 'dept-2',
            name: 'Marketing',
            budget: 200000,
            teams: [
              {
                id: 'team-2',
                name: 'Digital Marketing',
                members: [
                  {
                    id: 'emp-2',
                    name: 'Bob Smith',
                    role: 'Marketing Manager',
                    skills: ['SEO', 'Analytics'],
                    projects: [],
                  },
                ],
              },
            ],
          },
        },
      })
      await flushMicrotasks()
    })

    expect(
      container.querySelector('[data-testid="dept-name-dept-2"]')!.textContent
    ).toBe('Marketing')
    expect(
      container.querySelector('[data-testid="team-name-team-2"]')!.textContent
    ).toBe('Digital Marketing')
    expect(
      container.querySelector('[data-testid="member-name-emp-2"]')!.textContent
    ).toBe('Bob Smith')
  })

  it('should update React components with computed values based on deep nesting', async () => {
    const { state, update } = createComplexStore()
    let computedValue = 0

    function ComputedComponent() {
      const stateValue = useTrackedStore(state)
      const totalBudget = computed(() => {
        return stateValue.organization.departments.reduce(
          (sum: number, dept: any) => sum + dept.budget,
          0
        )
      })
      computedValue = totalBudget()
      return <div data-testid="total-budget">{totalBudget()}</div>
    }

    const { container } = render(<ComputedComponent />)

    expect(
      container.querySelector('[data-testid="total-budget"]')!.textContent
    ).toBe('500000')
    expect(computedValue).toBe(500000)

    // Add a new department with budget
    await act(async () => {
      update({
        $push: {
          'organization.departments': {
            id: 'dept-2',
            name: 'HR',
            budget: 150000,
            teams: [],
          },
        },
      })
      await flushMicrotasks()
    })

    expect(
      container.querySelector('[data-testid="total-budget"]')!.textContent
    ).toBe('650000')
  })

  it('should track fine-grained updates in React without over-rendering', async () => {
    const { state, update } = createComplexStore()
    let renderCount = 0

    function TaskOnlyComponent() {
      const stateValue = useTrackedStore(state)
      renderCount++
      const task = getTask(stateValue, 0, 0, 0, 0, 0)
      return <div data-testid="task-only">{task.title}</div>
    }

    const { container } = render(<TaskOnlyComponent />)
    expect(renderCount).toBe(1)

    // Update unrelated data - should not re-render
    await act(async () => {
      update({
        $set: {
          'organization.name': 'TechCorp Updated',
        },
      })
      await flushMicrotasks()
    })

    expect(renderCount).toBe(1) // No re-render because task wasn't accessed

    // Update the accessed task - should re-render
    await act(async () => {
      update({
        $set: {
          'organization.departments.0.teams.0.members.0.projects.0.tasks.0.title':
            'Updated Task',
        },
      })
      await flushMicrotasks()
    })

    expect(renderCount).toBe(2) // Re-rendered because task was updated
    expect(
      container.querySelector('[data-testid="task-only"]')!.textContent
    ).toBe('Updated Task')
  })

  it('should work correctly with memoized components and deep nesting', async () => {
    const { state, update } = createComplexStore()
    let orgRenderCount = 0
    let deptRenderCount = 0
    let teamRenderCount = 0
    let memberRenderCount = 0
    let projectRenderCount = 0
    let taskRenderCount = 0

    const MemoizedTaskComponent = React.memo(
      ({
        store,
        deptIndex,
        teamIndex,
        memberIndex,
        projectIndex,
        taskIndex,
      }: any) => {
        taskRenderCount++
        const state = useTrackedStore(store)
        const task = getTask(
          state,
          deptIndex,
          teamIndex,
          memberIndex,
          projectIndex,
          taskIndex
        )
        return (
          <div data-testid={`memoized-task-${task.id}`}>
            <span data-testid={`memoized-task-title-${task.id}`}>
              {task.title}
            </span>
            <span data-testid={`memoized-task-completed-${task.id}`}>
              {task.completed.toString()}
            </span>
          </div>
        )
      }
    )

    const MemoizedProjectComponent = React.memo(
      ({ store, deptIndex, teamIndex, memberIndex, projectIndex }: any) => {
        projectRenderCount++
        const state = useTrackedStore(store)
        const project = getProject(
          state,
          deptIndex,
          teamIndex,
          memberIndex,
          projectIndex
        )
        return (
          <div data-testid={`memoized-project-${project.id}`}>
            <h4 data-testid={`memoized-project-name-${project.id}`}>
              {project.name}
            </h4>
            <span data-testid={`memoized-project-status-${project.id}`}>
              {project.status}
            </span>
            {project.tasks.map((_: any, taskIndex: number) => (
              <MemoizedTaskComponent
                key={taskIndex}
                store={store}
                deptIndex={deptIndex}
                teamIndex={teamIndex}
                memberIndex={memberIndex}
                projectIndex={projectIndex}
                taskIndex={taskIndex}
              />
            ))}
          </div>
        )
      }
    )

    const MemoizedMemberComponent = React.memo(
      ({ store, deptIndex, teamIndex, memberIndex }: any) => {
        memberRenderCount++
        const state = useTrackedStore(store)
        const member = getMember(state, deptIndex, teamIndex, memberIndex)
        return (
          <div data-testid={`memoized-member-${member.id}`}>
            <h3 data-testid={`memoized-member-name-${member.id}`}>
              {member.name}
            </h3>
            <span data-testid={`memoized-member-role-${member.id}`}>
              {member.role}
            </span>
            {member.projects.map((_: any, projectIndex: number) => (
              <MemoizedProjectComponent
                key={projectIndex}
                store={store}
                deptIndex={deptIndex}
                teamIndex={teamIndex}
                memberIndex={memberIndex}
                projectIndex={projectIndex}
              />
            ))}
          </div>
        )
      }
    )

    const MemoizedTeamComponent = React.memo(
      ({ store, deptIndex, teamIndex }: any) => {
        teamRenderCount++
        const state = useTrackedStore(store)
        const team = getTeam(state, deptIndex, teamIndex)
        return (
          <div data-testid={`memoized-team-${team.id}`}>
            <h2 data-testid={`memoized-team-name-${team.id}`}>{team.name}</h2>
            {team.members.map((_: any, memberIndex: number) => (
              <MemoizedMemberComponent
                key={memberIndex}
                store={store}
                deptIndex={deptIndex}
                teamIndex={teamIndex}
                memberIndex={memberIndex}
              />
            ))}
          </div>
        )
      }
    )

    const MemoizedDepartmentComponent = React.memo(
      ({ store, deptIndex }: any) => {
        deptRenderCount++
        const state = useTrackedStore(store)
        const dept = getDept(state, deptIndex)
        return (
          <div data-testid={`memoized-dept-${dept.id}`}>
            <h1 data-testid={`memoized-dept-name-${dept.id}`}>{dept.name}</h1>
            <span data-testid={`memoized-dept-budget-${dept.id}`}>
              {dept.budget}
            </span>
            {dept.teams.map((_: any, teamIndex: number) => (
              <MemoizedTeamComponent
                key={teamIndex}
                store={store}
                deptIndex={deptIndex}
                teamIndex={teamIndex}
              />
            ))}
          </div>
        )
      }
    )

    const MemoizedOrganizationComponent = React.memo(({ store }: any) => {
      orgRenderCount++
      const state = useTrackedStore(store)
      return (
        <div data-testid={`memoized-org-${state.organization.id}`}>
          <h1 data-testid={`memoized-org-name-${state.organization.id}`}>
            {state.organization.name}
          </h1>
          {state.organization.departments.map((_: any, deptIndex: number) => (
            <MemoizedDepartmentComponent
              key={deptIndex}
              store={store}
              deptIndex={deptIndex}
            />
          ))}
        </div>
      )
    })

    const { container } = render(
      <MemoizedOrganizationComponent store={state} />
    )

    // Initial render - all components should render once
    expect(orgRenderCount).toBe(1)
    expect(deptRenderCount).toBe(1)
    expect(teamRenderCount).toBe(1)
    expect(memberRenderCount).toBe(1)
    expect(projectRenderCount).toBe(1)
    expect(taskRenderCount).toBe(2) // Two tasks

    // Verify initial content
    expect(
      container.querySelector('[data-testid="memoized-task-title-task-1"]')!
        .textContent
    ).toBe('Database Migration')

    // Update a deep nested task property - should only re-render affected components
    await act(async () => {
      update({
        $set: {
          'organization.departments.0.teams.0.members.0.projects.0.tasks.0.completed':
            true,
        },
      })
      await flushMicrotasks()
    })

    // With useTrackedStore in each component, only components that access the changed data should re-render
    expect(orgRenderCount).toBe(1) // Org doesn't access task data directly
    expect(deptRenderCount).toBe(1) // Dept doesn't access task data
    expect(teamRenderCount).toBe(1) // Team doesn't access task data
    expect(memberRenderCount).toBe(1) // Member doesn't access task data
    expect(projectRenderCount).toBe(1) // Project doesn't access task data directly
    expect(taskRenderCount).toBe(3) // Only the task component that changed should re-render (1 initial + 2 tasks + 1 re-render)

    // Verify the update was applied
    expect(
      container.querySelector('[data-testid="memoized-task-completed-task-1"]')!
        .textContent
    ).toBe('true')

    // Update organization name - should re-render org but not nested components
    await act(async () => {
      update({
        $set: {
          'organization.name': 'TechCorp Renamed',
        },
      })
      await flushMicrotasks()
    })

    expect(orgRenderCount).toBe(2) // Org should re-render since it accesses org.name
    expect(deptRenderCount).toBe(1) // Still should not re-render
    expect(teamRenderCount).toBe(1)
    expect(memberRenderCount).toBe(1)
    expect(projectRenderCount).toBe(1)
    expect(taskRenderCount).toBe(3) // Should stay the same

    // Verify org name update
    expect(
      container.querySelector('[data-testid="memoized-org-name-org-1"]')!
        .textContent
    ).toBe('TechCorp Renamed')
  })
})
