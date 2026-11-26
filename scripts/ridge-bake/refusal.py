"""The baker's refusal: raised wherever ridge.py or export.py declines a preset, a view or a bake.  The fixtures catch this class only, so an exception from numpy or the standard library reaching them is a crash (mutate.py: CRASHED), never a kill."""
class Refusal(ValueError): pass
