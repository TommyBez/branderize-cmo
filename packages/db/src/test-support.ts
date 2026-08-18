export const executeStatementsSequentially = async ({
  execute,
  position = 0,
  statements,
}: {
  readonly execute: (statement: string) => Promise<unknown>
  readonly position?: number
  readonly statements: readonly string[]
}): Promise<void> => {
  const statement = statements.at(position)
  if (statement === undefined) {
    return
  }

  await execute(statement)
  await executeStatementsSequentially({
    execute,
    position: position + 1,
    statements,
  })
}
