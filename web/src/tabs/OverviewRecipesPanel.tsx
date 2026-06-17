import type { Dispatch, SetStateAction } from 'react';
import type { AppError, DashboardState } from '../app-types';
import { toAppError } from '../app-types';

export interface OverviewRecipesPanelProps {
  dashboard: DashboardState;
  setDashboard: Dispatch<SetStateAction<DashboardState | null>>;
  setError: Dispatch<SetStateAction<AppError | null>>;
  recipeApplied: Set<string>;
  setRecipeApplied: Dispatch<SetStateAction<Set<string>>>;
  recipeExpanded: string | null;
  setRecipeExpanded: Dispatch<SetStateAction<string | null>>;
  recipeInputValues: Record<string, string>;
  setRecipeInputValues: Dispatch<SetStateAction<Record<string, string>>>;
  recipeApplying: boolean;
  setRecipeApplying: Dispatch<SetStateAction<boolean>>;
}

export function OverviewRecipesPanel(props: OverviewRecipesPanelProps) {
  const {
    dashboard,
    setDashboard,
    setError,
    recipeApplied,
    setRecipeApplied,
    recipeExpanded,
    setRecipeExpanded,
    recipeInputValues,
    setRecipeInputValues,
    recipeApplying,
    setRecipeApplying,
  } = props;
  const recipes = dashboard.recipes ?? [];
  if (recipes.length === 0) return null;

  return (
    <section className="panel recipes-panel" aria-label="One-click recipes">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Recipes</p>
          <h2>One-click outcomes</h2>
        </div>
      </div>
      <p className="footnote" style={{ marginBottom: '1rem' }}>
        Pick a recipe to wire up a real workflow. You only fill in what's missing.
      </p>
      <div className="recipes-grid">
        {recipes.map((recipe) => {
          const isActive = recipe.steps.every((s) =>
            dashboard.workers.find((w) => w.id === s.workerId)?.enabled,
          ) || recipeApplied.has(recipe.id);
          const isExpanded = recipeExpanded === recipe.id;
          const hasInputs = (recipe.requiredInputs?.length ?? 0) > 0;
          return (
            <div
              key={recipe.id}
              className={`recipe-card${isActive ? ' recipe-active' : ''}${isExpanded ? ' recipe-expanded' : ''}`}
            >
              <div className="recipe-card-header">
                <div className="recipe-card-title">
                  <strong>{recipe.label}</strong>
                  {isActive ? (
                    <span className="recipe-badge recipe-badge-active">Active</span>
                  ) : (
                    <span className="recipe-badge">{recipe.steps.length} worker{recipe.steps.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <p className="recipe-card-desc">{recipe.description}</p>
              </div>
              {!isActive && (
                <div className="recipe-card-actions">
                  {!isExpanded ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setRecipeExpanded(recipe.id);
                        setRecipeInputValues({});
                      }}
                    >
                      {hasInputs ? 'Set up →' : 'Enable →'}
                    </button>
                  ) : (
                    <div className="recipe-form">
                      {recipe.requiredInputs?.map((input) => (
                        <label key={input.key} className="field recipe-field">
                          <span>{input.label}</span>
                          <input
                            type={input.inputType === 'password' ? 'password' : 'text'}
                            value={recipeInputValues[input.key] ?? ''}
                            placeholder={input.helpText ?? ''}
                            onChange={(e) =>
                              setRecipeInputValues((prev) => ({ ...prev, [input.key]: e.target.value }))
                            }
                          />
                          {input.helpText ? (
                            <small className="footnote">{input.helpText}</small>
                          ) : null}
                        </label>
                      ))}
                      <div className="panel-actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={recipeApplying}
                          onClick={async () => {
                            setRecipeApplying(true);
                            try {
                              const res = await fetch('/api/recipes/apply', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ recipeId: recipe.id, inputs: recipeInputValues }),
                              });
                              const data = (await res.json()) as {
                                ok?: boolean;
                                applied?: boolean;
                                missing?: string[];
                                dashboard?: DashboardState;
                              };
                              if (data.dashboard) {
                                setDashboard(data.dashboard);
                              }
                              if (data.applied) {
                                setRecipeApplied((prev) => new Set([...prev, recipe.id]));
                                setRecipeExpanded(null);
                              }
                            } catch (err) {
                              setError(toAppError(err));
                            } finally {
                              setRecipeApplying(false);
                            }
                          }}
                        >
                          {recipeApplying ? 'Applying…' : 'Apply recipe'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRecipeExpanded(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
